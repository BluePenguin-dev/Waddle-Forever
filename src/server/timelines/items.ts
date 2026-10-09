import { ItemType } from "@server/game-logic/items";
import { Version } from "@server/routes/versions";
import { EquipProp } from "@server/socket-server/world/world-penguin";
import { UPDATES } from "@server/updates/updates";

const itemsReleaseIndex: Array<[Version, Set<number>]> = [];

const added = new Set<number>();

UPDATES.forEach(u => {
  if (u.update.clothingCatalog !== undefined) {
    const newItems = new Set<number>();
    u.update.clothingCatalog.newItems.forEach(i => {
      if (!added.has(i)) {
        newItems.add(i);
        added.add(i);
      }
    });
    itemsReleaseIndex.push([u.date, newItems]);
  }
});

export function getItemTypeFromEquipProp(prop: EquipProp): ItemType {
  return {
    'color': ItemType.Color,
    'head': ItemType.Head,
    'face': ItemType.Face,
    'neck': ItemType.Neck,
    'body': ItemType.Body,
    'hand': ItemType.Hand,
    'feet': ItemType.Feet,
    'pin': ItemType.Pin,
    'background': ItemType.Background
  }[prop];
}
type NewCatalogIndex = Array<{
  readonly start: Version;
  readonly end: Version | null;
  readonly newItems: number[]
}>;

type OldCatalogIndex = Array<{
  readonly start: Version;
  readonly end: Version | null;
  readonly items: number[]
}>;

const CATALOG_ADDED_ITEMS_INDEX: NewCatalogIndex = [];
const CATALOG_INCLUDED_ITEMS_INDEX: OldCatalogIndex = [];

function buildCatalogIndex(newIndex: NewCatalogIndex, oldIndex: OldCatalogIndex): void {
  const included = new Set<number>();
  let previousClothing: Version | null = null;
  const catalogIndexes: Array<{ index: number, type: 'clothing' | 'sport' }> = [];

  let previousSportDate: Version | null = null;

  for (let i = UPDATES.length - 1; i >= 0; i--) {
    const { date, update} = UPDATES[i];
    if (update.clothingCatalog !== undefined) {
      catalogIndexes.push({ index: i, type: 'clothing' });
      newIndex.push({
        start: date,
        end: previousClothing,
        newItems: [...update.clothingCatalog.newItems]
      });
      previousClothing = date;
    }
    if (update.sportCatalog !== undefined) {
      catalogIndexes.push({ index: i, type: 'sport' });
      newIndex.push({
        start: date,
        end: previousSportDate,
        newItems: [...update.sportCatalog.items]
      });
      previousSportDate = date;
    }
  }


  CATALOG_ADDED_ITEMS_INDEX.reverse();
  catalogIndexes.reverse();

  for (let i = 0; i < catalogIndexes.length; i++) {
    const info = catalogIndexes[i];
    if (info.type === 'clothing') {
      const clothingCatalog = UPDATES[info.index].update.clothingCatalog;
      if (clothingCatalog !== undefined) {
        clothingCatalog.newItems.forEach(item => included.add(item));
        clothingCatalog.removedItems.forEach(item => included.delete(item));
        oldIndex.push({
          start: CATALOG_ADDED_ITEMS_INDEX[i].start,
          end: CATALOG_ADDED_ITEMS_INDEX[i].end,
          items: [...included.values()]
        });
      }
    } else if (info.type === 'sport') {
      const items = UPDATES[info.index].update.sportCatalog?.items;
      if (items !== undefined) {
        oldIndex.push({
          start: CATALOG_ADDED_ITEMS_INDEX[i].start,
          end: CATALOG_ADDED_ITEMS_INDEX[i].end,
          items: [...items]
        })
      }
    }
  }

}

export function getAddedCatalogIndex(): NewCatalogIndex {
  return CATALOG_ADDED_ITEMS_INDEX;
}

export function getIncludedCatalogIndex(): OldCatalogIndex {
  return CATALOG_INCLUDED_ITEMS_INDEX;
}

buildCatalogIndex(CATALOG_ADDED_ITEMS_INDEX, CATALOG_INCLUDED_ITEMS_INDEX);

// partyItems logic
type NewPartyIndex = Array<{
  readonly start: Version;
  readonly end: Version | null;
  readonly newItems: number[]
}>;

type OldPartyIndex = Array<{
  readonly start: Version;
  readonly end: Version | null;
  readonly items: number[]
}>;

// The timeline entry has temp and end next to date. CPUpdateE does not.
type PartyTimelineEntry = {
  readonly date: Version;
  readonly update: CPUpdateE;
  readonly temp?: {
    readonly party?: {
      readonly partyItems?: readonly number[];
    };
  };
  readonly end?: readonly string[];
};

const PARTY_ADDED_ITEMS_INDEX: NewPartyIndex = [];
const PARTY_INCLUDED_ITEMS_INDEX: OldPartyIndex = [];
const PARTY_TIMELINE = UPDATES as readonly PartyTimelineEntry[];

// Fills the two indexes from temp.party.partyItems.
// An id opens when a party lists it and closes on end: ['party'], so the gap before the next party is empty.
function buildPartyItemIndex(newIndex: NewPartyIndex, oldIndex: OldPartyIndex): void {
  const partyEndByStart = new Map<Version, Version>();
  let partyStart: Version | null = null;

  for (const { date, temp, end } of PARTY_TIMELINE) {
    if (temp?.party !== undefined) partyStart = date;
    if (end?.includes('party') && partyStart !== null) {
      partyEndByStart.set(partyStart, date);
      partyStart = null;
    }
  }

  const opens: Array<{ date: Version; id: number; until: Version | null }> = [];
  let partyEnd: Version | null = null;

  const openAll = (date: Version, items: readonly number[]) => {
    for (const id of items) {
      if (partyEnd === null || date < partyEnd) opens.push({ date, id, until: partyEnd });
    }
  };

  for (const { date, temp, end } of PARTY_TIMELINE) {
    const items = temp?.party?.partyItems;
    if (temp?.party !== undefined && partyEndByStart.has(date)) {
      partyEnd = partyEndByStart.get(date) ?? null;
      if (items !== undefined) openAll(date, items);
    } else if (items !== undefined && partyEnd !== null) {
      // A later temp.party.partyItems list while this party is still open.
      openAll(date, items);
    }
    if (end?.includes('party')) partyEnd = null;
  }

  const points = new Set<Version>();
  for (const open of opens) {
    points.add(open.date);
    if (open.until !== null) points.add(open.until);
  }

  const dates = [...points].sort();
  const included = new Set<number>();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    for (const open of opens) if (open.until === date) included.delete(open.id);

    const newItems: number[] = [];
    for (const open of opens) {
      if (open.date === date) {
        included.add(open.id);
        newItems.push(open.id);
      }
    }

    newIndex.push({ start: date, end: dates[i + 1] ?? null, newItems });
    oldIndex.push({ start: date, end: dates[i + 1] ?? null, items: [...included] });
  }
}

// Dates where party items opened.
export function getAddedPartyItemIndex(): NewPartyIndex {
  return PARTY_ADDED_ITEMS_INDEX;
}

// What was obtainable in each stretch, including the empty gap between parties.
export function getIncludedPartyItemIndex(): OldPartyIndex {
  return PARTY_INCLUDED_ITEMS_INDEX;
}

buildPartyItemIndex(PARTY_ADDED_ITEMS_INDEX, PARTY_INCLUDED_ITEMS_INDEX);
