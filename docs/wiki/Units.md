# Units

**English** · [Deutsch](Einheiten)

> This page is generated from the game data (`npm run wiki`). Please make changes in `js/config.js` or `js/campaign.js`; English texts live in `scripts/wiki-en.json`.

Stats: cost in stars, health, attack, defence, movement, range. Veterans (after 3 victories) gain extra health.

## Land units

| Unit | Cost | Health | Attack | Defence | Movement | Range | Technology | Abilities |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Warrior** | 2 | 10 | 2 | 2 | 1 | 1 | – | Dash, Fortify |
| **Archer** | 3 | 10 | 2 | 1 | 1 | 2 | Archery | Dash, Fortify |
| **Ranger** | 4 | 10 | 2 | 2 | 1 | 1 | Forestry | Dash, Fortify, Pathfinder |
| **Rider** | 3 | 10 | 2 | 1 | 2 | 1 | Riding | Dash, Escape, Fortify |
| **Defender** | 3 | 15 | 1 | 3 | 1 | 1 | Shields | Fortify |
| **Pikeman** | 4 | 10 | 2 | 3 | 1 | 1 | Pikemen | Dash, Fortify, Pike Wall |
| **Swordsman** | 5 | 15 | 3 | 3 | 1 | 1 | Smithery | Dash |
| **Crossbowman** | 6 | 10 | 3 | 1 | 1 | 2 | Crossbow | Dash, Fortify |
| **Catapult** | 8 | 10 | 4 | 0 | 1 | 3 | Mathematics | Rigid |
| **Battering Ram** | 6 | 15 | 1 | 1 | 1 | 1 | Construction | Siege |
| **Mind Bender** | 5 | 10 | 0 | 1 | 1 | 1 | Philosophy | Heal, Convert, Rigid |
| **Banner Bearer** | 6 | 10 | 1 | 2 | 1 | 1 | Free Spirit | Fortify, Banner |
| **Horse Archer** | 6 | 10 | 2 | 1 | 2 | 2 | Horseshoes | Dash, Escape |
| **Knight** | 9 | 10 | 3 | 1 | 3 | 1 | Chivalry | Dash, Persist, Fortify |
| **Paladin** | 13 | 15 | 4 | 2 | 3 | 1 | Knightly Orders | Dash, Persist, Fortify |
| **Trader Cart** | 5 | 6 | 0 | 1 | 2 | 1 | Trade | Trade |
| **Giant** (reward only) | – | 40 | 5 | 4 | 1 | 1 | – | Static |
| **Spy** | 4 | 6 | 0 | 1 | 2 | 1 | – | Scout |
| **Settler** | 5 | 10 | 0 | 0 | 1 | 1 | – | Static, Settle |

## Ships

| Unit | Cost | Health | Attack | Defence | Movement | Range | Technology | Abilities |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Boat** | 3 | 10 | 2 | 0 | 2 | 1 | Sailing | Dash, Fortify |
| **Ship** | 5 | 14 | 3 | 1 | 2 | 2 | Sailing | Dash, Fortify |
| **Fire Ship** | 6 | 8 | 4 | 0 | 3 | 1 | Aquatism | Dash, Incendiary |
| **Battleship** | 8 | 18 | 4 | 2 | 3 | 2 | Navigation | Dash, Fortify |

## Air units

| Unit | Cost | Health | Attack | Defence | Movement | Range | Technology | Abilities |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Hot Air Balloon** | 4 | 4 | 0 | 1 | 3 | 1 | Ballooning | Fly, Fragile |
| **Cargo Balloon** | 6 | 6 | 0 | 1 | 3 | 1 | Ballooning | Fly, Fragile, Transport |
| **Fire Balloon** | 8 | 6 | 3 | 0 | 2 | 1 | Airship Building | Fly, Fragile |
| **War Airship** | 12 | 12 | 3 | 2 | 2 | 2 | Airship Building | Fly, Large Hull |

## Abilities

| Ability | Effect |
| --- | --- |
| **Dash** | Can attack after moving. |
| **Fortify** | Heals when it does nothing; gets the city defence bonus. |
| **Escape** | Can keep moving after attacking. |
| **Persist** | Can keep moving after attacking. |
| **Rigid** | Cannot attack after moving and cannot strike back. |
| **Static** | No special abilities. |
| **Heal** | Heals adjacent allies by 4 at the start of the turn. |
| **Convert** | Takes over an adjacent enemy unit. |
| **Land** | Can stand on land. |
| **Water** | Can only move on shallow water and ocean. |
| **Settle** | Founds a new city on a free tile (at least 2 tiles away from other cities). |
| **Scout** | Does not attack, enters mountains without Climbing and sees 1 tile further from mountains. |
| **Fly** | Flies over water, mountains and forest (1 movement each) and ignores zones of control. Melee units cannot reach it. Does not capture cities, heals only in own territory. |
| **Fragile** | A single hit from a ranged unit (archer, catapult, ship, airship) destroys it instantly. |
| **Large Hull** | Takes double damage from ranged units. |
| **Transport** | Picks up an adjacent friendly land unit and drops it off elsewhere. |
| **Siege** | Triple damage against units in cities and on castles; no counterattack there. |
| **Trade** | In or next to another city: one-time stars, more the farther it is from its home city. Does not capture cities. |
| **Pike Wall** | 1.5× damage against riders, knights and paladins, also when striking back. |
| **Pathfinder** | Forest, hills and swamp cost only 1 movement and do not stop it; +1 attack from the forest. |
| **Banner** | Friendly units right next to it get +0.5 attack (several banners do not stack). |
| **Incendiary** | Sinks when attacking, but also hits every enemy next to the target for half damage. No counterattack. |

## Upgrading

A unit that starts its turn inside your own territory can be upgraded for the difference in price (requires the technology, uses up its turn):

- Warrior becomes Swordsman
- Archer becomes Crossbowman
- Rider becomes Knight
- Knight becomes Paladin
- Boat becomes Ship
- Ship becomes Battleship
- Hot Air Balloon becomes Fire Balloon
- Fire Balloon becomes War Airship
