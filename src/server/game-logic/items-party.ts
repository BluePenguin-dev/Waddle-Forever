import { Version } from "@server/routes/versions";
import { UPDATES } from "@server/updates/updates";

const PARTY_ITEMS: Array<{ date: Version; items: number[]; }> = [];

UPDATES.forEach(u => {
  if (u.update.partyItems !== undefined) {
    PARTY_ITEMS.push({
      date: u.date,
      items: [...u.update.partyItems]
    })
  }
});

export function getPartyItems() {
  return PARTY_ITEMS;
}
