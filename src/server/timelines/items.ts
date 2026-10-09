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
type PartyItemListing = number | { readonly id: number; readonly until?: Version };

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

const PARTY_ADDED_ITEMS_INDEX: NewPartyIndex = [];
const PARTY_INCLUDED_ITEMS_INDEX: OldPartyIndex = [];

// A listing is either a plain id, or { id, until } for an item pulled before the party ended
// This returns the id either way
function partyItemId(item: PartyItemListing): number {
  return typeof item === 'number' ? item : item.id;
}

// Walks UPDATES once and fills the two indexes
// An item opens when a party lists it, and normally closes on end: ['party'].
function buildPartyItemIndex(newIndex: NewPartyIndex, oldIndex: OldPartyIndex): void {
  const partyEndByStart = new Map<Version, Version>();
  let partyStart: Version | null = null;

  // Pair each party start with the later end: ['party'] date
  for (const { date, update } of UPDATES) {
    if (update.temp?.party !== undefined) partyStart = date;
    if (update.end?.includes('party') && partyStart !== null) {
      partyEndByStart.set(partyStart, date);
      partyStart = null;
    }
  }

  const opens: Array<{ date: Version; id: number; until: Version | null }> = [];
  let partyEnd: Version | null = null;

  // Open every listed item. 'until' is the party end, unless this item has an earlier exception
  // until: null means the party has no end entry yet, so the item is still available.
  const openAll = (date: Version, items: readonly PartyItemListing[]) => {
    for (const item of items) {
      const explicit = typeof item === 'number' ? undefined : item.until;
      const until = explicit !== undefined && (partyEnd === null || explicit < partyEnd)
        ? explicit
        : partyEnd;
      if (until === null || date < until) opens.push({ date, id: partyItemId(item), until });
    }
  };

  for (const { date, update } of UPDATES) {
    if (update.temp?.party !== undefined) {
      partyEnd = partyEndByStart.get(date) ?? null;
      openAll(date, update.temp.party.items ?? []);
    }
    // A mid-party release. It still closes with this party unless it has its own until.
    if (update.partyItems?.newItems !== undefined && partyEnd !== undefined) {
      openAll(date, update.partyItems.newItems);
    }
    if (update.end?.includes('party')) partyEnd = null;
  }

  // Every open and every close is a date where the obtainable set changes.
  // The first timeline date is included so the stretch before the first party is empty too.
  const points = new Set<Version>();
  const timelineStart = UPDATES[0]?.date;
  if (timelineStart !== undefined) points.add(timelineStart);
  for (const open of opens) {
    points.add(open.date);
    if (open.until !== null) points.add(open.until);
  }

  const dates = [...points].sort();
  const included = new Set<number>();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    // Close first, so a party end does not count as still obtainable on that date.
    for (const open of opens) if (open.until === date) included.delete(open.id);

    const newItems: number[] = [];
    for (const open of opens) {
      if (open.date === date) {
        included.add(open.id);
        newItems.push(open.id);
      }
    }

    // newIndex records what opened on this date. oldIndex records everything still open after that.
    // end is the next change date, or null if nothing else changes.
    newIndex.push({ start: date, end: dates[i + 1] ?? null, newItems });
    oldIndex.push({ start: date, end: dates[i + 1] ?? null, items: [...included] });
  }
}

export function getAddedPartyItemIndex(): NewPartyIndex {
  return PARTY_ADDED_ITEMS_INDEX;
}

export function getIncludedPartyItemIndex(): OldPartyIndex {
  return PARTY_INCLUDED_ITEMS_INDEX;
}

buildPartyItemIndex(PARTY_ADDED_ITEMS_INDEX, PARTY_INCLUDED_ITEMS_INDEX);
