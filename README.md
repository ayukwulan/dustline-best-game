[![make.fun](https://make.fun/badge/best-game-01)](https://make.fun/bounty/best-game-01)
[![rank](https://make.fun/badge/best-game-01/9vSzBPphkDoHMBPy3Q3nLRKxzT5fwDcyDVhxHnq6bk9n/best-game-01/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard)
[![reward](https://make.fun/badge/best-game-01/9vSzBPphkDoHMBPy3Q3nLRKxzT5fwDcyDVhxHnq6bk9n/best-game-01/reward.svg)](https://make.fun/bounty/best-game-01)

# DUSTLINE — Take the yard. Hold the line.

An offline, round-based tactical FPS set in **Yard 9**, an abandoned freight
terminal at dusk. You lead **SABLE** against five **HARBOR** defenders. Four
allied bots push the lanes with you. Plant your charge in the west warehouse
(Site A) or east container terminal (Site B), or eliminate the defending squad.
First to eight round wins takes the yard; a match lasts at most fifteen rounds.

The map, low-poly operators, weapon models, signs, textures and synthesized
sounds are created for this game. The rendering engine is three.js 0.187.0,
vendored locally. Every browser resource lives under `game/`; no build or
internet connection is needed to play.

Run `node serve.ts --port 8080`, then open `http://127.0.0.1:8080` in desktop
Chrome. Click **Deploy**, buy equipment, and click **Ready** to capture the mouse.
The round begins after the twelve-second requisition period. A live round lasts
100 seconds. Escape releases the mouse; click the capture button to resume.

| Control | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Left / right mouse | Fire / aim down sights |
| R / B | Reload / requisition during the buy phase |
| 1 / 2 / 3 / 4 | Primary / sidearm / HE / smoke |
| G | Throw selected utility, or HE then smoke when holding a gun |
| Ctrl / Shift / Space | Crouch / sprint / jump |
| E, held | Plant for 3 seconds; HARBOR bots defuse for 5 seconds |
| X | Drop the charge so a squadmate can carry and plant it |
| Tab / M / Escape | Round roster / mute / release mouse |

Stop inside a site and hold E to plant. Shooting, moving or taking damage
interrupts the action. The charge detonates after 35 seconds. Defenders must
reach the actual case to defuse it. If you fall, your squad can recover the
charge and finish the round. You respawn at the next requisition phase.

| Weapon | Cost | Role |
| --- | ---: | --- |
| P9 Sidearm | Free | Accurate opening-round pistol, 12-round magazine |
| Vex-9 | $1,500 | 750 rpm SMG for close engagements |
| AR-77 Dusk | $2,700 | 30-round rifle; short controlled bursts |
| Breacher 12 | $1,200 | Eight-pellet shotgun for tight doorways |
| Longbow .50 | $4,750 | Slow heavy sniper with a narrow ADS view |

Standing still, crouching and aiming tighten spread. Running, jumping and
sustained fire increase it. Headshots multiply damage, distance reduces it,
and a $650 field vest absorbs half of incoming damage until its armor runs out.
Spark HE and Haze Smoke each cost $300; carry up to two of each. HE deals up to
90 damage within six metres, with cover blocking blasts. Smoke blocks bot sight
for fourteen seconds; bullets can still pass through it.

You begin with $800. Kills pay $300, planting pays the planter $300, and a round
win pays $3,250 to each squad member. Consecutive losses pay $1,900, $2,400,
$2,900, then $3,400. Funds cap at $16,000. Survive to keep your weapons, armor
and unused grenades. Dying loses equipment. Magazines and reserves refill at
the next round; switching weapons during a round preserves ammunition.

`node capture.mjs` regenerates four 1280×800 JPEGs from the game's deterministic
`?shot=start|play|buy|end&seed=1` scenes. It uses local Chromium and waits for
`window.__shotReady` after rendering. `node playtest.mjs` exercises the browser
and core round rules against a server running on port 8091.

Build the hand-in with `MAKEFUN_OUTPUT_DIR=out node main.ts`. The Node standard
library copies the game and screenshots and writes the kit's deterministic
`out/dossier.json`. Running the command again replaces those folders cleanly.

MIT license for DUSTLINE. The three.js license is beside its local builds.
The two repository badges currently use the public owner address from
`.makefun/owner.json` because this checkout has no Git remote.
