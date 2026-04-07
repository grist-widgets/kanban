<script>
  import { flip } from "svelte/animate";
  import { dndzone } from "svelte-dnd-action";
  import { onMount } from "svelte";
  import {
    BOARD_COLUMNS,
    buildBoard,
    buildStatusSpec,
    buildUpdatePayload,
    cloneBoard,
    createDemoPayload,
    createRecordFields,
    getMappedColumnId,
  } from "./lib/board.js";

  const BOARD_TYPE = "kanban-card";
  const FLIP_DURATION_MS = 180;
  const SAVE_DEBOUNCE_MS = 70;

  let runtime = "loading";
  let errorMessage = "";
  let interaction = null;
  let mappings = null;
  let mappedRecords = [];
  let statusSpec = { choices: [] };
  let overrideBoard = null;
  let gristApi = null;
  let saving = false;
  let saveError = "";
  let saveTimer = null;
  let metadataRequestId = 0;

  $: baseBoard = buildBoard(mappedRecords, statusSpec);
  $: board = overrideBoard ?? baseBoard;
  $: hasRequiredMappings = Boolean(
    getMappedColumnId(mappings, "Title") && getMappedColumnId(mappings, "Status"),
  );
  $: hasPositionMapping = Boolean(getMappedColumnId(mappings, "Position"));
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
      statusSpec = demoPayload.statusSpec;
      return;
    }

    gristApi = window.grist;
    runtime = "grist";

    gristApi.ready({
      requiredAccess: "full",
      columns: BOARD_COLUMNS,
    });

    gristApi.onOptions((_options, nextInteraction) => {
      interaction = nextInteraction;
      overrideBoard = null;
    });

    gristApi.onRecords(async (records, nextMappings) => {
      mappings = nextMappings;
      mappedRecords = gristApi.mapColumnNames(records) ?? [];
      overrideBoard = null;
      saveError = "";
      await refreshStatusSpec(nextMappings, mappedRecords);
    });

  }

  async function refreshStatusSpec(nextMappings, records) {
    const statusColumnId = getMappedColumnId(nextMappings, "Status");
    if (!gristApi || !statusColumnId) {
      statusSpec = buildStatusSpec(null, records);
      return;
    }

    const requestId = ++metadataRequestId;

    try {
      const [tables, columns, tableId] = await Promise.all([
        gristApi.docApi.fetchTable("_grist_Tables"),
        gristApi.docApi.fetchTable("_grist_Tables_column"),
        gristApi.selectedTable.getTableId(),
      ]);

      if (requestId !== metadataRequestId) {
        return;
      }

      const tableRef = tables.id[tables.tableId.indexOf(tableId)];
      const index = columns.id.findIndex(
        (_id, columnIndex) =>
          columns.parentId[columnIndex] === tableRef
          && columns.colId[columnIndex] === statusColumnId,
      );

      if (index === -1) {
        statusSpec = buildStatusSpec(null, records);
        return;
      }

      const columnRecord = Object.fromEntries(
        Object.keys(columns).map((field) => [field, columns[field][index]]),
      );
      statusSpec = buildStatusSpec(columnRecord, records);
    } catch {
      statusSpec = buildStatusSpec(null, records);
    }
  }

  function updateLaneItems(laneId, items) {
    const nextBoard = cloneBoard(overrideBoard ?? baseBoard);
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
    updateLaneItems(laneId, event.detail.items);
    queuePersist();
  }

  function queuePersist() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      void persistBoard(cloneBoard(overrideBoard ?? baseBoard));
    }, SAVE_DEBOUNCE_MS);
  }

  async function persistBoard(nextBoard) {
    saveTimer = null;

    if (runtime === "demo") {
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
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
      overrideBoard = null;
    } finally {
      saving = false;
    }
  }

  async function focusCard(cardId) {
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

  function dragStyle(element) {
    element.style.boxShadow = "0 26px 60px rgba(15, 23, 42, 0.24)";
    element.style.rotate = "-1.25deg";
  }
</script>

<svelte:head>
  <title>Grist Kanban</title>
</svelte:head>

<main class="app-shell">
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
        <h2>No lanes yet</h2>
        <p>Add choices to the mapped Status column, or create rows with Status values.</p>
      </section>
    {/if}

    {#if saveError}
      <section class="panel empty-panel compact-panel">
        <p>{saveError}</p>
      </section>
    {/if}

    <section class="board-wrap">
      <div class="board-scroll">
        {#each board as lane, laneIndex (lane.id)}
          <section class="lane" style={`${lane.style}; --lane-order: ${laneIndex};`}>
            <header class="lane-header">
              <div>
                <h2>{lane.label}</h2>
              </div>

              <div class="lane-header-actions">
                <span class="lane-count">{lane.items.length}</span>
                {#if canWrite}
                  <button class="ghost-button" type="button" on:click={() => createCard(lane)}>
                    Add card
                  </button>
                {/if}
              </div>
            </header>

            <div class="lane-dropzone-shell">
              <div
                aria-label={lane.label}
                class:lane-dropzone-empty={lane.items.length === 0}
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
                {#each lane.items as card (card.id)}
                  <button
                    aria-label={card.ariaLabel}
                    animate:flip={{ duration: FLIP_DURATION_MS }}
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

              {#if lane.items.length === 0}
                <div class="empty-stack" aria-hidden="true">
                  <p>Drop a card here</p>
                </div>
              {/if}
            </div>
          </section>
        {/each}
      </div>
    </section>
  {/if}
</main>
