export const EMPTY_LANE_ID = "__grist_kanban_empty__";
export const EMPTY_LANE_LABEL = "Unassigned";

export const BOARD_COLUMNS = [
  {
    name: "Title",
    title: "Card title",
    description: "Primary text shown on each Kanban card.",
    type: "Text",
  },
  {
    name: "Status",
    title: "Lane",
    description: "Choice or text column used to place cards into lanes.",
    type: "Choice",
  },
  {
    name: "Position",
    title: "Sort order",
    description: "Optional numeric column used to persist manual card order.",
    type: "Numeric",
    optional: true,
  },
  {
    name: "Description",
    title: "Description",
    description: "Optional longer text shown under the title.",
    type: "Text",
    optional: true,
  },
  {
    name: "Assignee",
    title: "Assignee",
    description: "Optional person or owner text shown as a pill.",
    optional: true,
  },
  {
    name: "Due",
    title: "Due date",
    description: "Optional due date shown in the card footer.",
    type: "Date",
    optional: true,
  },
  {
    name: "Tags",
    title: "Tags",
    description: "Optional tag or choice-list field.",
    optional: true,
  },
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export function createDemoPayload() {
  return {
    statusSpec: {
      choices: [
        { value: "Backlog", color: "#7a56d8" },
        { value: "In Progress", color: "#1c8c72" },
        { value: "Review", color: "#e05947" },
        { value: "Done", color: "#2664eb" },
      ],
    },
    mappings: Object.fromEntries(
      BOARD_COLUMNS.map((column) => [column.name, column.name]),
    ),
    records: [
      {
        id: 1,
        Title: "Mirror the reference widget without inheriting its clunky drag feel",
        Status: "Backlog",
        Position: 1024,
        Description: "Focus on card density, quick scanning, and smoother lane-to-lane motion.",
        Assignee: "Sam",
        Due: new Date("2026-04-10T12:00:00Z"),
        Tags: ["UX", "Discovery"],
      },
      {
        id: 2,
        Title: "Wire the board to Grist mappings",
        Status: "In Progress",
        Position: 1024,
        Description: "Use Title and Status as the minimum viable mapping pair.",
        Assignee: "Svelte",
        Due: new Date("2026-04-08T12:00:00Z"),
        Tags: ["Data"],
      },
      {
        id: 3,
        Title: "Persist ordering with an optional numeric Position column",
        Status: "In Progress",
        Position: 2048,
        Description: "Reorder inside a lane should survive a refresh when Position is mapped.",
        Assignee: "Grist",
        Tags: ["State"],
      },
      {
        id: 4,
        Title: "Add animated card lift and settle motion",
        Status: "Review",
        Position: 1024,
        Description: "Cards should feel attached to the pointer rather than teleporting.",
        Assignee: "Motion",
        Due: new Date("2026-04-12T12:00:00Z"),
        Tags: ["Animation"],
      },
      {
        id: 5,
        Title: "Document setup flow for use inside Grist",
        Status: "Done",
        Position: 1024,
        Description: "Keep the repo usable as a static custom widget.",
        Assignee: "Docs",
        Tags: ["Docs"],
      },
    ],
  };
}

export function buildBoard(records, statusSpec = null) {
  const colorByValue = new Map(
    (statusSpec?.choices ?? []).map((choice) => [choice.value, choice.color ?? null]),
  );

  const cards = (records ?? []).map((record, index) =>
    createCard(record, index, colorByValue.get(normalizeLaneValue(record.Status))),
  );
  const detectedOrder = cards
    .map((card) => card.laneValue)
    .filter((value) => value !== null);

  const orderedValues = mergeLaneOrder(
    (statusSpec?.choices ?? []).map((choice) => choice.value),
    detectedOrder,
  );
  const lanes = orderedValues.map((value) => createLane(value, colorByValue.get(value)));

  if (cards.some((card) => card.laneValue === null)) {
    lanes.push(createLane(null));
  }

  const laneMap = new Map(lanes.map((lane) => [lane.id, lane]));
  for (const card of cards) {
    laneMap.get(card.laneId)?.items.push(card);
  }

  for (const lane of lanes) {
    lane.items.sort(compareCards);
  }

  return lanes;
}

export function cloneBoard(lanes) {
  return lanes.map((lane) => ({
    ...lane,
    items: lane.items.map((item) => ({ ...item })),
  }));
}

export function mergeLaneOrder(existingOrder = [], detectedOrder = []) {
  const ordered = [];
  const seen = new Set();

  for (const value of [...existingOrder, ...detectedOrder]) {
    if (value === null || value === undefined) {
      continue;
    }

    const laneName = String(value).trim();
    if (!laneName || seen.has(laneName)) {
      continue;
    }

    seen.add(laneName);
    ordered.push(laneName);
  }

  return ordered;
}

export function extractLaneOrder(lanes) {
  return lanes
    .map((lane) => lane.value)
    .filter((value) => value !== null);
}

export function getMappedColumnId(mappings, key) {
  const value = mappings?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function buildUpdatePayload(lanes, records, mappings) {
  const statusField = getMappedColumnId(mappings, "Status");
  const positionField = getMappedColumnId(mappings, "Position");

  if (!statusField) {
    return [];
  }

  const currentById = new Map((records ?? []).map((record) => [record.id, record]));
  const updates = [];

  for (const lane of lanes) {
    for (const [index, card] of lane.items.entries()) {
      const current = currentById.get(card.id);
      if (!current) {
        continue;
      }

      const fields = {};
      const nextStatus = lane.value;
      if (normalizeLaneValue(current.Status) !== nextStatus) {
        fields[statusField] = nextStatus;
      }

      if (positionField) {
        const nextPosition = (index + 1) * 1024;
        if (!numbersMatch(current.Position, nextPosition)) {
          fields[positionField] = nextPosition;
        }
      }

      if (Object.keys(fields).length) {
        updates.push({ id: card.id, fields });
      }
    }
  }

  return updates;
}

export function applyBoardToRecords(lanes, records) {
  const recordsById = new Map((records ?? []).map((record) => [record.id, { ...record }]));

  for (const lane of lanes) {
    for (const [index, card] of lane.items.entries()) {
      const record = recordsById.get(card.id);
      if (!record) {
        continue;
      }

      record.Status = lane.value;
      if ("Position" in record || record.Position !== undefined) {
        record.Position = (index + 1) * 1024;
      }
    }
  }

  return Array.from(recordsById.values());
}

export function createRecordFields(lane, mappings, lanes) {
  const titleField = getMappedColumnId(mappings, "Title");
  const statusField = getMappedColumnId(mappings, "Status");
  const positionField = getMappedColumnId(mappings, "Position");
  const fields = {};

  if (titleField) {
    fields[titleField] = "New card";
  }

  if (statusField) {
    fields[statusField] = lane.value;
  }

  if (positionField) {
    const laneCards = lanes.find((entry) => entry.id === lane.id)?.items ?? [];
    fields[positionField] = (laneCards.length + 1) * 1024;
  }

  return fields;
}

export function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return dateFormatter.format(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    if ("name" in value && value.name) {
      return String(value.name);
    }
    if ("label" in value && value.label) {
      return String(value.label);
    }
    return JSON.stringify(value);
  }

  return String(value);
}

export function toTagList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean);
  }

  const text = toText(value);
  return text ? [text] : [];
}

function createCard(record, index, statusColor) {
  const laneValue = normalizeLaneValue(record.Status);
  const title = toText(record.Title) || `Row ${record.id}`;
  const description = toText(record.Description);
  const assignee = toText(record.Assignee);
  const dueText = formatDueDate(record.Due);
  const tags = toTagList(record.Tags);

  return {
    id: record.id,
    laneId: laneValue ?? EMPTY_LANE_ID,
    laneValue,
    title,
    description,
    assignee,
    dueText,
    tags,
    position: toNumber(record.Position),
    sortIndex: index,
    style: buildCardStyle(statusColor, laneValue ?? title),
    ariaLabel: [
      title,
      assignee ? `assigned to ${assignee}` : null,
      dueText ? `due ${dueText}` : null,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

function createLane(value, color = null) {
  const label = value ?? EMPTY_LANE_LABEL;
  const accent = color?.trim() || fallbackAccent(label);

  return {
    id: value ?? EMPTY_LANE_ID,
    value,
    label,
    items: [],
    style: [`--lane-accent: ${accent}`].join("; "),
  };
}

function buildCardStyle(statusColor, fallback) {
  return `--card-accent: ${statusColor?.trim() || fallbackAccent(fallback)};`;
}

function compareCards(left, right) {
  if (left.position !== null && right.position !== null && left.position !== right.position) {
    return left.position - right.position;
  }

  if (left.position !== null && right.position === null) {
    return -1;
  }

  if (left.position === null && right.position !== null) {
    return 1;
  }

  return left.sortIndex - right.sortIndex;
}

function normalizeLaneValue(value) {
  const text = toText(value).trim();
  return text ? text : null;
}

function formatDueDate(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }

  return dateFormatter.format(date);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function numbersMatch(value, expected) {
  const numeric = toNumber(value);
  return numeric !== null && Math.abs(numeric - expected) < 0.001;
}

function hueFromString(value) {
  const text = String(value ?? "lane");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function fallbackAccent(value) {
  return `hsl(${hueFromString(value)} 58% 48%)`;
}

export function buildStatusSpec(columnRecord, records = []) {
  const options = safeParse(columnRecord?.widgetOptions) ?? {};
  const configuredChoices = Array.isArray(options.choices)
    ? options.choices.map((choice) => String(choice))
    : [];
  const choiceOptions = isRecord(options.choiceOptions) ? options.choiceOptions : {};
  const discoveredChoices = (records ?? [])
    .map((record) => normalizeLaneValue(record.Status))
    .filter((value) => value !== null);

  return {
    choices: mergeLaneOrder(configuredChoices, discoveredChoices).map((value) => ({
      value,
      color: readChoiceColor(choiceOptions[value]),
    })),
  };
}

function readChoiceColor(choiceOption) {
  if (!isRecord(choiceOption)) {
    return null;
  }

  return (
    toText(choiceOption.fillColor).trim()
    || toText(choiceOption.backgroundColor).trim()
    || toText(choiceOption.color).trim()
    || null
  );
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
