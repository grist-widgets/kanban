<script>
  import { flip } from "svelte/animate";
  import { dndzone } from "svelte-dnd-action";
  import { onMount } from "svelte";
  import {
    BOARD_COLUMNS,
    LANE_ORDER_OPTION_KEY,
    applyBoardToRecords,
    buildBoard,
    buildUpdatePayload,
    cloneBoard,
    createDemoPayload,
    createRecordFields,
    extractLaneOrder,
    getMappedColumnId,
    mergeLaneOrder,
  } from "./lib/board.js";

  const BOARD_TYPE = "kanban-card";
  const FLIP_DURATION_MS = 180;
  const SAVE_DEBOUNCE_MS = 70;

  let runtime = "loading";
  let errorMessage = "";
  let interaction = null;
  let mappings = null;
  let mappedRecords = [];
  let widgetOptions = {};
  let selectedRowId = null;
  let overrideBoard = null;
  let gristApi = null;
  let saving = false;
  let saveError = "";
  let saveTimer = null;
  let addListName = "";
  let listEditorOpen = false;

  $: laneOrder = widgetOptions?.[LANE_ORDER_OPTION_KEY] ?? [];
  $: baseBoard = buildBoard(mappedRecords, laneOrder);
  $: board = overrideBoard ?? baseBoard;
  $: hasRequiredMappings = Boolean(
    getMappedColumnId(mappings, "Title") && getMappedColumnId(mappings, "Status"),
  );
  $: hasPositionMapping = Boolean(getMappedColumnId(mappings, "Position"));
  $: cardCount = board.reduce((sum, lane) => sum + lane.items.length, 0);
  $: canWrite = runtime === "grist" ? interaction?.accessLevel === "full" : true;

  onMount(() => {
    setupRuntime();

    return () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
      }
    };
  });

  function setupRuntime() {
    const demoPayload = createDemoPayload();

    if (window.parent === window || !window.grist) {
      runtime = "demo";
      mappedRecords = demoPayload.records;
      mappings = demoPayload.mappings;
      widgetOptions = demoPayload.options;
      return;
    }

    gristApi = window.grist;
    runtime = "grist";

    gristApi.ready({
      requiredAccess: "full",
      columns: BOARD_COLUMNS,
    });

    gristApi.onOptions((options, nextInteraction) => {
      widgetOptions = options ?? {};
      interaction = nextInteraction;
      overrideBoard = null;
    });

    gristApi.onRecords((records, nextMappings) => {
      mappings = nextMappings;
      mappedRecords = gristApi.mapColumnNames(records) ?? [];
      overrideBoard = null;
      saveError = "";

      const statuses = (mappedRecords ?? [])
        .map((record) => record.Status)
        .filter((value) => typeof value === "string" && value.trim());
      const mergedLaneOrder = mergeLaneOrder(laneOrder, statuses);
      if (JSON.stringify(mergedLaneOrder) !== JSON.stringify(laneOrder)) {
        widgetOptions = {
          ...widgetOptions,
          [LANE_ORDER_OPTION_KEY]: mergedLaneOrder,
        };
        void gristApi.setOption(LANE_ORDER_OPTION_KEY, mergedLaneOrder);
      }
    });

    gristApi.onRecord((record) => {
      selectedRowId = record?.id ?? null;
    });
  }

  function updateLaneItems(laneId, items) {
    const nextBoard = cloneBoard(board);
    const lane = nextBoard.find((entry) => entry.id === laneId);
    if (!lane) {
      return nextBoard;
    }

    lane.items = items.map((item) => ({
      ...item,
      laneId: lane.id,
      laneValue: lane.value,
    }));
    overrideBoard = nextBoard;
    return nextBoard;
  }

  function handleConsider(laneId, event) {
    updateLaneItems(laneId, event.detail.items);
  }

  function handleFinalize(laneId, event) {
    const nextBoard = updateLaneItems(laneId, event.detail.items);
    queuePersist(nextBoard);
  }

  function queuePersist(nextBoard) {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      void persistBoard(nextBoard);
    }, SAVE_DEBOUNCE_MS);
  }

  async function persistBoard(nextBoard) {
    saveTimer = null;

    if (runtime === "demo") {
      widgetOptions = {
        ...widgetOptions,
        [LANE_ORDER_OPTION_KEY]: extractLaneOrder(nextBoard),
      };
      mappedRecords = applyBoardToRecords(nextBoard, mappedRecords);
      overrideBoard = null;
      return;
    }

    if (!gristApi || !hasRequiredMappings || !canWrite) {
      return;
    }

    saving = true;
    saveError = "";

    try {
      const updates = buildUpdatePayload(nextBoard, mappedRecords, mappings);
      if (updates.length) {
        await gristApi.selectedTable.update(updates);
      }

      const nextLaneOrder = extractLaneOrder(nextBoard);
      if (JSON.stringify(nextLaneOrder) !== JSON.stringify(laneOrder)) {
        widgetOptions = {
          ...widgetOptions,
          [LANE_ORDER_OPTION_KEY]: nextLaneOrder,
        };
        await gristApi.setOption(LANE_ORDER_OPTION_KEY, nextLaneOrder);
      }
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
      overrideBoard = null;
    } finally {
      saving = false;
    }
  }

  async function focusCard(cardId) {
    selectedRowId = cardId;
    if (runtime === "grist" && gristApi?.setCursorPos) {
      await gristApi.setCursorPos({ rowId: cardId });
    }
  }

  async function createCard(lane) {
    if (!canWrite) {
      return;
    }

    if (runtime === "demo") {
      const nextId =
        mappedRecords.reduce((highest, record) => Math.max(highest, record.id), 0) + 1;
      mappedRecords = [
        ...mappedRecords,
        {
          id: nextId,
          Title: "New card",
          Status: lane.value,
          Position: (lane.items.length + 1) * 1024,
          Description: "",
          Assignee: "",
          Tags: [],
          Accent: "",
        },
      ];
      return;
    }

    if (!gristApi || !hasRequiredMappings) {
      return;
    }

    try {
      const fields = createRecordFields(lane, mappings, board);
      const record = await gristApi.selectedTable.create({ fields });
      await focusCard(record.id);
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
  }

  async function addLane() {
    const nextLane = addListName.trim();
    if (!nextLane) {
      return;
    }

    const nextLaneOrder = mergeLaneOrder(laneOrder, [nextLane]);
    widgetOptions = {
      ...widgetOptions,
      [LANE_ORDER_OPTION_KEY]: nextLaneOrder,
    };

    addListName = "";
    listEditorOpen = false;
    overrideBoard = null;

    if (runtime === "grist") {
      await gristApi?.setOption(LANE_ORDER_OPTION_KEY, nextLaneOrder);
    }
  }

  async function removeLane(lane) {
    const nextLaneOrder = laneOrder.filter((value) => value !== lane.value);
    widgetOptions = {
      ...widgetOptions,
      [LANE_ORDER_OPTION_KEY]: nextLaneOrder,
    };
    overrideBoard = null;

    if (runtime === "grist") {
      await gristApi?.setOption(LANE_ORDER_OPTION_KEY, nextLaneOrder);
    }
  }

  function dragStyle(element) {
    element.style.boxShadow = "0 26px 60px rgba(15, 23, 42, 0.24)";
    element.style.rotate = "-1.25deg";
  }
</script>

<svelte:head>
  <title>Grist Kanban</title>
</svelte:head>

<main class="app-shell">
  <section class="hero">
    <div>
      <p class="eyebrow">Svelte 5 Custom Widget</p>
      <h1>Kanban board for Grist</h1>
      <p class="lede">
        Smooth card movement, animated list settling, and direct writes back to your Grist table.
      </p>
    </div>

    <div class="status-cluster">
      <span class="status-pill">{runtime === "demo" ? "Local preview" : "Connected to Grist"}</span>
      <span class:warn-pill={!hasPositionMapping} class="meta-pill">
        {hasPositionMapping ? "Order persists" : "Map Position to persist ordering"}
      </span>
      {#if saving}
        <span class="meta-pill">Saving…</span>
      {/if}
    </div>
  </section>

  {#if runtime === "loading"}
    <section class="panel empty-panel">
      <h2>Loading widget…</h2>
      <p>Waiting for the board environment.</p>
    </section>
  {:else if errorMessage}
    <section class="panel empty-panel">
      <h2>Widget error</h2>
      <p>{errorMessage}</p>
    </section>
  {:else}
    <section class="toolbar panel">
      <div class="toolbar-copy">
        <strong>{cardCount}</strong> cards across <strong>{board.length}</strong> lists
      </div>

      <div class="toolbar-actions">
        {#if runtime === "demo"}
          <span class="toolbar-note">
            This preview runs with local sample data. Inside Grist, card moves write back to the table.
          </span>
        {/if}
        {#if saveError}
          <span class="error-note">{saveError}</span>
        {/if}
      </div>
    </section>

    {#if runtime === "grist" && !hasRequiredMappings}
      <section class="panel empty-panel">
        <h2>Map the board columns first</h2>
        <p>
          Assign at least <strong>Title</strong> and <strong>Status</strong> in the creator panel.
          Add <strong>Position</strong> as well if you want drag reordering inside a lane to persist.
        </p>
      </section>
    {:else if board.length === 0}
      <section class="panel empty-panel">
        <h2>No lists yet</h2>
        <p>Add a list below, or create rows in Grist with a Status value.</p>
      </section>
    {/if}

    <section class="board-wrap">
      <div class="board-scroll">
        {#each board as lane, laneIndex (lane.id)}
          <section class="lane" style={`${lane.style}; --lane-order: ${laneIndex};`}>
            <header class="lane-header">
              <div>
                <p class="lane-kicker">List {String(laneIndex + 1).padStart(2, "0")}</p>
                <h2>{lane.label}</h2>
              </div>

              <div class="lane-header-actions">
                <span class="lane-count">{lane.items.length}</span>
                {#if canWrite}
                  <button class="ghost-button" type="button" on:click={() => createCard(lane)}>
                    Add card
                  </button>
                {/if}
                {#if canWrite && lane.items.length === 0 && lane.value !== null}
                  <button class="icon-button" type="button" on:click={() => removeLane(lane)}>
                    Remove
                  </button>
                {/if}
              </div>
            </header>

            <div
              aria-label={lane.label}
              class="lane-dropzone"
              use:dndzone={{
                items: lane.items,
                type: BOARD_TYPE,
                flipDurationMs: FLIP_DURATION_MS,
                dropTargetClasses: ["active-dropzone"],
                dragDisabled: !canWrite,
                dropFromOthersDisabled: !canWrite,
                centreDraggedOnCursor: true,
                useCursorForDetection: true,
                transformDraggedElement: dragStyle,
              }}
              on:consider={(event) => handleConsider(lane.id, event)}
              on:finalize={(event) => handleFinalize(lane.id, event)}
            >
              {#if lane.items.length === 0}
                <div class="empty-stack">
                  <p>Drop a card here</p>
                </div>
              {/if}

              {#each lane.items as card (card.id)}
                <button
                  aria-label={card.ariaLabel}
                  animate:flip={{ duration: FLIP_DURATION_MS }}
                  class:selected={selectedRowId === card.id}
                  class="card"
                  style={card.style}
                  type="button"
                  on:click={() => focusCard(card.id)}
                  on:keydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void focusCard(card.id);
                    }
                  }}
                >
                  <div class="card-accent"></div>
                  <div class="card-body">
                    <h3>{card.title}</h3>

                    {#if card.description}
                      <p class="card-description">{card.description}</p>
                    {/if}

                    {#if card.tags.length}
                      <div class="tag-row">
                        {#each card.tags as tag}
                          <span class="tag">{tag}</span>
                        {/each}
                      </div>
                    {/if}

                    <footer class="card-footer">
                      {#if card.assignee}
                        <span class="person-pill">{card.assignee}</span>
                      {/if}
                      {#if card.dueText}
                        <span class="due-pill">{card.dueText}</span>
                      {/if}
                    </footer>
                  </div>
                </button>
              {/each}
            </div>
          </section>
        {/each}

        <section class="lane lane-composer panel">
          <div class="lane-composer-body">
            <h2>Create list</h2>
            <p>Persist an empty lane even before any card lands in it.</p>

            {#if listEditorOpen}
              <div class="composer-form">
                <input
                  bind:value={addListName}
                  maxlength="60"
                  placeholder="For example: QA"
                  type="text"
                  on:keydown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addLane();
                    }
                  }}
                />
                <button class="solid-button" type="button" on:click={addLane}>Save list</button>
              </div>
            {:else}
              <button class="solid-button" type="button" on:click={() => (listEditorOpen = true)}>
                Add list
              </button>
            {/if}
          </div>
        </section>
      </div>
    </section>
  {/if}
</main>
