# Cities and Buildings

**English** · [Deutsch](Staedte-und-Gebaeude)

> This page is generated from the game data (`npm run wiki`). Please make changes in `js/config.js` or `js/campaign.js`; English texts live in `scripts/wiki-en.json`.

## City levels

When a city grows to a new level, you pick one of two rewards:

| Level | Choice 1 | Choice 2 |
| --- | --- | --- |
| 2 | **Workshop**: +1 star per turn | **Explorer**: Reveals the surroundings within 4 tiles |
| 3 | **City Wall**: Defenders in this city get 4× defence | **Resources**: +5 stars immediately |
| 4 | **Population Growth**: +1 population (towards next level) | **Border Growth**: City area grows to a radius of 2 tiles |
| 5 | **Park**: +1 star per turn | **Giant**: A giant (40 health) appears at the city |

## Buildings

You build from the city menu with **Ausbauen** (Build): tap a tile in the city area, then choose the building.

| Building | Cost | Terrain | Technology | Yield |
| --- | --- | --- | --- | --- |
| **Farm** | 6 | Field | Farming | +1 per turn |
| **Sawmill** | 7 | Forest | Forestry | +1 per turn |
| **Mine** | 6 | Mountain, Hill | Mining | +1 per turn |
| **Port** | 7 | Shallow water, Ocean | Sailing | +1 per turn |
| **Temple** | 10 | Field | Meditation | +2 per turn |
| **Balloon Field** | 8 | Field | Ballooning | +1 per turn |
| **Windmill** | 6 | Field | Milling | +1, +1 per adjacent Farm |
| **Smelter** | 6 | Field | Smelting | +1, +2 per adjacent Mine, +1 per adjacent Mountain without a building |
| **Market** | 8 | Field | Markets | +1 per adjacent building (up to 5), resources count too |
| **Watchtower** | 5 | Field, Mountain, Hill | Shields | Sight 3 tiles; units on and next to it defend at 1.5× |
| **Fishing Hut** | 5 | Shallow water | Fishing | +1 per turn, +1 per adjacent fishing ground |
| **Castle** | 10 | Field, Forest, Hill | Castle Building | Units on it defend at 3× |
| **Monastery** | 12 | Field | Monasticism | +2, units in the territory heal more |
| **Road** | 3 | Land | Roads | Moving from road to road costs half a movement point |
| **Bridge** | 5 per tile | Shallow water, up to 2 tiles | Roads | Land units can cross water |

## Monuments

Monuments are free. Every tribe can build each one once, on a field or forest tile in a city area. Each gives the city +3 population and 200 points.

| Monument | Unlocked by |
| --- | --- |
| **Tower of Wisdom** | 20 technologies researched |
| **Gate of Valour** | 10 enemy units defeated |
| **Eye of the World** | All lighthouses found |
| **Treasury** | 100 stars owned at once |
| **Grand Park** | Three cities at level 5 |
| **Imperial Palace** | 8 cities owned |

## Terrain and resources

| Terrain | Walkable | Movement | Defence | Entry requires | Notes |
| --- | --- | --- | --- | --- | --- |
| Field | yes | 1 | 1× | – | – |
| Forest | yes | 2 | 1.5× | – | – |
| Mountain | yes | 2 | 1.5× | Climbing | – |
| Shallow water | no (ships) | 2 | 1.5× | – | – |
| Ocean | no (ships) | 2 | 1.5× | – | – |
| Ice | yes | 1 | 1× | – | – |
| Hill | yes | 1 | 1.5× | – | Units on it see 1 tile further |
| Swamp | yes | 1 | 0.75× | – | Entering ends movement |

Resources in a city area give a yield as long as nothing is built on them: Fruit (Field), Wild animals (Forest), Fish (Shallow water), Minerals (Mountain).

## Mercenary camps

Depending on map size there are 2 (small), 3 (normal), 4 (large) camps. One of your land units standing on a camp can hire the unit on offer, even without the required technology. Every tribe can use each camp once, which uses up the unit's turn. Price: normal cost + 2 stars.

| Possible offer | Price |
| --- | --- |
| Swordsman | 7 |
| Crossbowman | 8 |
| Knight | 11 |
| Pikeman | 6 |
| Horse Archer | 8 |
| Catapult | 10 |
