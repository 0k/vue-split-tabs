# @0k/vue-split-tabs

Content-agnostic split / tab layout. The controller owns saved intent, the
layout algebra and the effective layout; components render it and handle
gestures. Hosts own tab content, labels, storage keys, routing, data, themes
and key bindings.

## Vocabulary (use these words, in code and docs)

- **view**: one host tab id, or a **placeholder** id the controller creates
  for a new pane or tab (prefix `placeholderPrefix`). The host fills a
  placeholder with whatever it wants, typically via `replace(placeholder, id)`.
- **tab set**: a tab bar and the tab it shows. A tab holds a view, a
  **layout** (a cut) or another tab set (an **inner bar**).
- **pane**: the content area of a tab set showing a view. The **bar** sits
  outside the pane, beside it. **frame**: a tab set showing a layout or an
  inner bar, with its bar outside its frame content.
- **cut**: two parts of an area, `rows` (stacked) or `cols` (side by side),
  with a **divider**.
- **focus** (one pane), **selection** (several panes), **group** (rebuild the
  cuts so the selection becomes one node), **scope** (the area a pane is a
  tile of), **bar focus** (the bar whose label was last clicked).
- Commands act on the **target**: the selection, grouped first, else the
  focused pane. **Tab next to** (`tabNext`) adds to the bar holding the
  target; **tabs inside** (`tabInside`) puts a new bar in the target's place.
- Splits are named by the side the new part goes to (`left/right/top/bottom`),
  never "vertical/horizontal".

## User decisions (durable; change only with the user's authorization)

- Arrange mode is exclusively for managing panes (user decision, 2026-11-09).
  Capture and cancel EVERY page key (including keyup), pointer, mouse, click,
  context-menu, wheel and touch event outside the library's own arrange UI.
  Pane iframe helpers receive the mode and isolate their content too; only
  arrange control keys reach the shell, with no content-facing claimed noise.
  The bound `arrange` chord exits the mode; other layout chords stay swallowed.
  Tab/Shift+Tab cycle the enabled controls in the host Done slot, library menus
  and undo slot, never page/pane content or the pointer-only drag bin. The inline rename editor owns its
  typing keys and Escape. The root undo slot is library arrange UI and must work
  after a bin drop. Validate `arrangeExitKeys` at mount, like `exitKeys`.
  Covers must stay above overlay/iframe content. Plain Q joins Escape,
  Ctrl+G and Ctrl+D while arranging (`arrangeExitKeys`, default `['KeyQ']`);
  reserve q from pane letters. Every arrange exit clears selection AND bar
  focus. Offer the host-labelled arrange action menu, reusing target commands,
  refusal wording and glyphs; preserve the host-positioned `#arrange` Done slot.
  Never restore content passthrough or selection preservation without approval.
- Every tab is renamable by default (user decision, 2026-11-07), including
  view, layout and inner-bar tabs. Hosts may disable renaming with
  `renamable: boolean | ((key: string) => boolean)`. Double-click edits inline;
  touch uses the host-labelled rename menu item. Enter/blur commit; leaving the
  strip or unmounting commits an unfinished edit exactly once, in every engine.
  Escape cancels editing without exiting layout modes. Pickers must not consume
  editor typing, and modifier releases must reach shell tracking. Titles follow stable keys;
  new groups inherit no title, replacement drops the old title, removed keys
  are pruned on write, blank and out-of-tree stored titles are pruned on read,
  and close undo restores titles. Never remove this
  default without the user's authorization.
- The layout algebra (`src/algebra.ts`) is the specification ported from the
  user's split / tab grouping mock-up; `test/algebra.test.ts` ports its tests
  one to one, except that the 2026-11-07 self-split decision overrides the
  mock-up's own-split `into-itself` assertion. Keep its grammar: a tab set
  nested as a tab and left with one tab is replaced by that tab; a tab set
  whose only tab is a layout or a tab
  set dissolves into it; bars of two tabs or more never merge.
- The bar is outside the pane. It's not the business of the pane content.
  The library owns every tab set's bar, beside its pane/frame content on any
  side. Host pane/frame slots supply CONTENT ONLY, never strips. Pane marks,
  opacity, covers, pick badges and middle/quarter drops MUST exclude bars.
- A tab bar with one tab is HIDDEN by default (`SplitTabs.alwaysShow` opts out,
  boolean or per-tab-set function). Never show single-tab bars by default,
  split or not. Host bar controls use root `bar-start`/`bar-end` slots; request
  a visible bar for controls needed on a one-tab set. Do not invent a second
  hidden-bar control location.
- Drop zones: a drop on a tab bar adds a tab NEXT to the others at the marker;
  a drop in a pane's MIDDLE adds a tab INSIDE that zone (an inner bar); a
  pane's outer QUARTER places the dragged content on that side of a cut;
  a self-drop follows the self-split decision below. A thin band along a frame splits
  beside the whole tab set; a thin band along the root splits the whole area;
  the bin (shown while dragging) closes what is dragged.
- Dropping a pane onto ITSELF splits its own area (user decision, 2026-11-09):
  a pane drag or its SHOWN tab's label dropped on its own outer quarter splits
  INSIDE the shown tab. Replace only that entry with a layout tab: the shown
  content goes on the dropped side, a fresh placeholder opposite gets focus
  like `split()`, and the bar keeps all other tabs with `active` on the new
  layout tab. Never move the entire multi-tab set outside the shown tab.
  A one-tab set normalizes to the cut, as before. A NON-shown label dropped
  on its own pane edge keeps the existing drag-out rule, without a placeholder.
  Hidden siblings stay outside the shown entry's split. An only visible tab's
  own middle/bar refuses `nothing-to-move` without a write.
  The ratio is 0.5; no room for both minimums and the divider means `no-room`,
  with no write. Own middle stays a refused no-op.
  Frames use their existing own outer band and keep the whole tab set. A
  selection can self-split only when its grouping plan is `single`; never
  move a group into one of its members. Both preview halves must be visible
  and distinct, including refused previews; new-pane wording is host-only
  `labels.newPane`. Keep this rule identical for touch, mouse, keyboard and
  controller moves; do not change it without the user's authorization.
- New panes and tabs created by commands hold placeholders; the library never
  invents host tabs.
- Key bindings are the host's: `SplitTabs` takes a `keymap` (default
  `defaultKeymap`, Alt+Shift + physical key codes; `null` binds nothing).
  Commands are also callable directly (controller methods, `run`).
- Win/Super is Meta even on WebKitGTK when `metaKey` and every modifier-state
  getter stay false. Track physical MetaLeft/MetaRight/OSLeft/OSRight or keys
  Meta/Super/OS/Hyper; combine that held state with native `metaKey` everywhere
  chords are matched (commands, exits, pointers and label reorder exactness).
  Keyup and hidden visibility reset it at once; a window blur resets it only
  when focus has not returned within 500 ms (Unity/compiz blur and refocus the
  window ~30 ms after a Win press), in the shell and the frame helper alike;
  non-Meta covers still drop at blur. Iframes report effective
  Meta; accepted reports govern shell pointer chords until release. Hosts use
  the public `createChordTracker()` for identical strict matching; observers
  are shared per window, reference-counted, and removed with the last owner.
  AltGraph remains typing, never a chord. Never replace physical tracking
  with modifier-state getters or assume a false `metaKey` means Win is up.
- `displayPanes` is the library's timed numbered-pane mode, not a host overlay.
  Reuse the picker badges and `numberOf`: numbers read left to right across
  rows, then top to bottom, independently of cut-tree traversal. Its default
  binding is Alt+Shift+KeyQ and `displayPanesTimeout` defaults to 2000 ms.
  Plain digits 1–9 focus that numbered pane and its keyboard, then exit; 0 is
  not a tenth-pane shortcut. Unified exit keys cancel unchanged. Digits/exits
  own down/repeats/up in capture, across iframe focus transfers too. Any other
  key ends display without consumption; every press ends it, with badges
  focusing their pane. Cancel timers/listeners on every exit and unmount.
- Every modal mode belongs to the library, including keyboard exit. The user's
  decision: "if I click escape, ctrl g, ctrl d it should quit this and not give
  the escape / ctrl d to anything below"; "it should listen for escape, control
  G, control D before anything else, of course"; "everything that should be in
  the library should be put in it". `exitKeys` defaults to Escape, Ctrl+KeyG,
  Ctrl+KeyD independently of `keymap` (`[]`/`null` disables). Capture on window
  while modal: arrange exits together with its drag/menu/picker; outside
  arrange, exit the innermost mode, except in the inline title
  editor, which owns its typing keys and Escape. Prevent default, stop
  propagation AND immediate propagation; retain the consumed press through its
  repeats and keyup. Remove listeners after exit/release and on unmount. Reuse
  strict keymap chord validation; exact modifiers, physical codes, no AltGraph.
  Send active exit chords to iframe helpers on mode/policy changes; never take
  them outside a mode unless separately bound as commands. `clear` remains the
  separate selection/bar-focus command. Hosts supply a visible Done control
  through `#arrange { run, done }`; never add built-in strings.
- A successful bound layout command WINS over typing, even in inputs,
  textareas and contenteditable. Hosts choose non-clashing keyboard chords.
  Outside arrange isolation, modal exits and display-pane digits, unbound keys are NEVER cancelled. On the page, refused/no-op commands leave
  keys to typing. Non-repeatable commands run once per held physical key:
  repeats follow the initial keydown's cancellation decision, never run the
  command again, and never swallow a hold whose first press was let through.
  Remember decisions per key code; reset on keyup (page or iframe), window
  blur and unmount. An orphan repeat must not start a non-repeatable command.
  Match exact modifier sets; AltGraph is typing, never a layout chord or cover.
  Outside arrange isolation, modal exits and display-pane digits, iframe helpers cancel only bound chords, including refused commands
  and repeats because postMessage cannot synchronously return a verdict.
  Resend bound chords to every iframe whenever the effective keymap changes.
- The focused pane (and each selected pane) must stay VISIBLY marked even over
  iframe / overlay content, and the host must be able to choose how: a border,
  dimming the other panes (opacity), or both, each through its own CSS
  variable (`--split-tabs-focus-border`, `--split-tabs-unfocused-opacity`,
  `--split-tabs-focused-opacity`, ...). Never mark focus only on the pane
  element: overlay content covers it.
- The tab ✕ is the host's choice (`closeButton`: `never`, `active`, `hover`,
  `always`). Default `active`: only the shown tab has a ✕, so a click meant to
  switch tabs can never close one.
- Dividers are at least 1 px (`dividerSize` below 1 throws); never offer 0.
- Touch is first class and ships in the library: arrange mode (four-finger
  hold, holding a divider still, or the `arrange` command), four-finger pinch
  out / in to zoom / restore, and the iframe helper `@0k/vue-split-tabs/frame`.
- From the THIRD finger a touch sequence belongs to the layout, not to the
  content (user decision, 2026-11-07): each shell counts only touches whose
  target is inside its root, plus its own iframe reports. The shell and frame
  helper cancel `touchstart`/`touchmove` from three owned fingers, so the browser never
  pans (no `pointercancel`, no content scroll), and every pane of that root is covered
  (`modes.gesture`, the arrange/grab cover) until all fingers lift. One and two
  fingers stay the content's (scroll, pinch-zoom); what they did before the
  third finger cannot be undone. Touch events (`touches` identifiers) are the
  source of truth. Touch pointerdowns inside the root and touch down reports
  from its iframes are provisional hints: count them immediately for covers,
  hold and pinch, and tell the sequence-owning iframe to block at once from
  the second finger. Chromium routes a sequence's touches to its first finger's
  document, so other documents may report only pointers until movement.
  Reconcile hints when touch snapshots cover them; drop unmatched hints on
  pointer up/cancel, silence or unmount. A touch pointerup retires a finger
  learned from another document only until that document's snapshot omits its
  identifier or a touchstart re-lists it; identifiers may be reused before the
  sequence ends. Never retain retirement for the entire sequence.
  Pointercancel MUST NOT drop fingers
  reported by touch events: Android WebView cancels every pointer it takes
  over while touch events keep coming. Hit-test other-document touch points
  in page coordinates against this root, excluding fingers outside it.
  A still four-finger hold must complete even from provisional hints alone.
  Pointer events also remain the source for mouse and pen.

## Rules

- `capture` and iframe `identify` use one policy builder: emit on shell
  create/change/dispose (empty on dispose), never identical consecutive
  policies. Native host key replays go through `createChordTracker`'s
  host-supplied `trusted` predicates: any live tracker may vouch for an event,
  regardless of creation order; disposing a tracker removes its predicate.
- Intent is `{ version: 3, tree, focus, opened, titles? }`, with optional
  `titles: Record<string, string>` keyed by view or node id (no version bump).
  Old intents without titles remain valid. The tree is an unlimited-depth tree of
  cuts and tab sets with stable ids. All keys (node ids and view ids) are
  unique in a tree. Never reuse node or placeholder ids within a controller
  lifetime, including ids read from stored trees. Every action leaves a tree
  that reloads through the storage validator.
- Persist intent, not effective layout. Size, tab-list and host-navigation
  changes never write storage. Every changed user action writes ONCE, after
  the working copy pipeline: place implicit tabs, fold, host overlay, command.
- Visible = placeholder, or present and (not optional or opened). Present
  visible host tabs not in the tree go to the first pane (depth first, before
  folding) after their nearest placed natural predecessor there, otherwise
  first; this is derived until the next write materializes it.
- Absent views keep their place. A branch or tab with no visible view is not
  rendered; an explicit action folds it, moving its views (hidden) into the
  nearest surviving tab set so they come back there.
- A tab set's shown entry is its `active` one when visible, else the nearest
  visible neighbour. When an action removes the shown tab, the replacement is
  the most recently shown remaining tab of that tab set (memory-only history,
  learned only inside controller actions), else the neighbour.
- Close only removes closable views: placeholders and optional host tabs.
  A close whose target holds a visible non-closable view is refused as a
  whole (`not-closable`, listing them). Closing everything leaves one pane
  with a fresh placeholder. Closes snapshot for one `undo`; the root offers
  the `#undo` slot for `undoTimeout` ms.
- Focus is remembered as the focused view: pane clicks / `focusPane` persist
  a changed focus immediately; keyboard `focusDirection` stays in memory
  until the next write;
  selection, bar focus and zoom are memory only and reset on entry key change.
  Zoom never changes the tree except by the grouping it needs; layout
  commands (split, tabs, group, bar side, moves) restore first, like tmux.
- The host `active` binding is the focused pane's shown view. Actions set it
  when it changes; a host request for a visible view reveals it (every tab on
  its way shown, its pane focused) without writing; a request for a hidden or
  unknown view changes nothing.
- Results never carry visible strings: `{ ok: false, reason, nodes? }` with a
  `SplitTabsReason`; the host words its messages (`command` event).
- Labels are always host-supplied; never introduce built-in visible strings.
  A control whose label is missing is not rendered. Default tab content is
  the custom title when set, else the view id or a layout tab's views joined by `+`.
- Derive size collapse top-down without changing intent or writing: a cut
  renders only when its axis fits two minimum panes, their visible bars and
  a divider; otherwise
  its subtree is one collapsed pane listing all its visible views and showing
  the focused one if inside, else the first pane's; selecting there reveals the
  view in the real tree. The exact tree comes back when space returns.
- Divider press/release without movement never commits; an actual drag
  commits once. Two presses within 350 ms equalize (touch makes no reliable
  dblclick); holding still 500 ms toggles arrange mode; focused Enter
  equalizes. Equalize spans the maximal rendered same-axis cut run; frames and
  collapsed subtrees are single segments; water-fill around effective minima.
  Live drags snap centre on centre to other parallel dividers within 12 px, so
  the two line up to the pixel, and show a guide (never to pane edges).
  Divider clamps use full subtree minimums (sum plus dividers along the axis,
  maximum across, plus every visible tab set's bar, including view panes).
- Bars sit on any side (`side`); left / right bars are vertical, resizable
  from their inner edge (persisted `barWidth`, never below `sideBarWidth`,
  double press restores it) and their labels reorder with Alt+Shift+Up/Down.
  A bar drag goes through the controller live (`setBarWidthLive`) so the whole
  layout, overlay content included, follows it, and is saved once at release;
  overlay content ignores the pointer during the drag.
- Marks drawn over panes (focus, selection) and overlay content never carry
  `data-pane-id`: that attribute identifies pane elements for drops and hit
  tests. They use `data-pane-of`.
- `.split-tabs-tabset[data-tabset-id]` owns the bar and content siblings;
  `.split-tabs-bar[data-bar-id]` also retains strip hooks. `data-pane-id`
  identifies content ONLY, never the outer tab-set box. Top/bottom bar height
  is `barThickness` (`--split-tabs-bar-thickness`); bars never flex-shrink away.
  `SplitTabStrip` remains exported for standalone navigation only, never as
  content of a root's pane/frame slot.
- Keep content never remounts on moves, collapse, zoom or restore. Teleport
  retargeting for ordinary content; `SplitTabsKeep overlay` content (iframes)
  is teleported ONCE into the root's keep layer and only positioned over its
  anchor, because moving an iframe in the DOM reloads it.
- Pointer actions on panes use the host's `pointerChords` (modifier sets for
  `toggle`, `rectangle`, `move`; `null` disables one; default Alt+Shift click
  toggles, Ctrl+Alt+Shift click selects the rectangle from the focused pane,
  Alt+Shift drag moves). Never hard-code modifiers in components. Holding
  exactly an enabled chord's modifiers (or arrange mode) covers panes above
  overlay content so clicks and drags reach the layout over iframes; any other
  press focuses the pane and belongs to its content. The first toggle also
  takes the focused pane.
- Iframes cannot be seen by the shell: content cooperates through the frame
  helper (presses, keys, finger reports, `split-tabs-claimed` events). The
  shell accepts reports only from iframes inside its root and from allowed
  origins (default: its own). Silence of 2.5 s drops every counted finger.
  Finger reports and the shell count shell and iframe fingers together for the
  third-finger ownership above.
- Never identify a reporting iframe by `MessageEvent.source` alone: WebKit
  gives the RECEIVING window. The shell hands each iframe a random token
  (`identify`, on `hello` and on every iframe load) that every report carries;
  the frame helper accepts shell messages by origin. Test iframe input in
  WebKit as well as Chromium.
- A press in a pane focuses it and clears the selection and the bar focus,
  even when that pane already had the focus.
- Pane chords must work wherever the keyboard is: keys held in another
  document never reach the shell, so a chord press reaching pane content
  (iframe report or this page) follows the cover's tap/drag path, and pane
  iframes report modifiers on pointer moves so covers show before a click.
  A mouse/pen press that beats the iframe's modifier reports must still drag
  through the same drag instance; never reduce it to selection only.
- Overlay content is repositioned whenever its anchor's box changes, not only
  on layout changes (a bar appearing must never end up under an iframe).
- No per-tab split buttons: splitting is done by drag, keymap or context menu.
- The marked focus and the keyboard focus must agree: when a layout key moves
  the focus, the library gives the keyboard to the newly focused pane (its
  iframe, else its first focusable content, else the pane element itself).
- Pointer gestures use window listeners and clean up on up, cancel, unified exit keys
  and unmount, timers included. One press/drag at a time per root; a drag
  cannot target another root. Mouse drags start beyond 6 px. Label touch/pen
  presses must hold 350 ms first; moving more than 6 px before that cancels
  and lets the browser scroll. When armed or dragging by touch, a non-passive
  window touchmove handler prevents panning; remove that exact handler on every
  exit. Never rely on changing touch-action after touch start. The multi-finger
  blocker (shell and frame helper) follows the same rule: registered non-passive
  from the SECOND finger (so the third finger's touchstart is cancellable),
  removed with its exact identity when fewer than two fingers remain, on silence and on
  unmount/disconnect; never a permanent non-passive touch listener, so one-finger
  scrolling stays passive. Never use HTML5
  drag-and-drop. During drags and resizes iframes and overlay content get
  pointer-events none.
- External drags use the SAME drag instance (`SplitTabs.startExternalDrag`).
  The host owns the threshold and hands over an armed pointer. Absent ids may
  preview targets; on a valid drop requiring insertion, `beforeDrop` registers
  the id inside `insert`'s registration callback, after the zone is resolved and before
  placement. Already-visible ids are moved without calling `beforeDrop`.
  Cancellation and invalid drops never call it.
- Mouse-drag click suppression consumes only the immediate pointer click
  (`detail > 0`) and expires after the current task; keyboard activation is
  never suppressed. Clear suppression timers on disposal.
- Tab labels are ordinary named buttons with `aria-pressed`, not tablist/tab
  roles; host slot text stays the accessible name. Selected buttons use
  `split-tab-strip-tab--active`. Alt+Shift+Left/Right (Up/Down when vertical)
  on a focused label reorders one slot without changing the shown tab, keeps
  focus, and is not taken by the keymap.
- `SplitTabsGlyph` is the single drawing for split/move/close icons.
- Tab menus use host labels and an ordered items subset; never built-in strings.
- One pane picker per root: numbers (`pick`) move a tab and show it; letters
  (`select`) toggle the selection; keyboard move (`move`) takes a letter, then
  Alt+Up/Down widen or narrow the destination through `controller.scopes`, an
  arrow splits on that side, Enter drops inside. Register window listeners only
  while a mode is active; unified exit keys, outside presses and pane changes cancel.
  `display` reuses the same numbered badges to focus, without moving a tab;
  its digits are handled by the unified modal capture, not a second key path.
- Use CSS custom properties with the `--split-tabs-` prefix and host class
  hooks; document every variable in README.org. No 1px borders and no imposed
  palette or typography.
- Android System WebView 91 is the compatibility floor. Do not use newer
  runtime APIs without a compatible implementation; keep compatibility tests.
- Do not add domain navigation, routing, fetching, or application themes.
- Keep source lines readable (at most 160 characters). Write specification
  tests first and run `npm run check` before delivery, including the
  post-build artifact smoke test, consumer type probes, and real-browser
  acceptance with real CDP touch input and iframes. Build output is ESM-only
  (`index.js`, `frame.js`) with types; Vue stays external; the frame entry
  imports nothing. CSS is explicitly copied/exported and never imported by the
  JavaScript entry. Clear dist before build so stale output cannot ship.
- Relative TypeScript-module imports use .js extensions. Published component
  types target moduleResolution:bundler; verify the strict NodeNext consumer
  probe but do not claim support while Vue SFC exports remain unresolved.
- Stored intent: one LRU table under `storageKey`, refreshed and validated
  before every write; replace only this controller's entry, stamp above every
  stored stamp, drop only invalid entries, keep the highest-stamp duplicate.
  Storage failures never break in-memory use. 0.2 trees and 0.1 two-pane
  entries migrate on read to equivalent tab sets (first leaf: its tabs plus
  unassigned ids in saved order; others sorted by saved order; first shown =
  `firstActive`).
- Releases are published publicly to npm with the `pkg` release workflow from
  a tagged commit; `package.json` keeps `%%version%%`, substituted from the tag.
- Release/tag/publish only with explicit authorization. Install release helpers
  with `pkg vendor`, never by hand-copying. Run `pkg check` for setup
  validation; keep the registry/github-release feature declarations and
  canonical changelog configuration.
- Consumers depend on the npm release. Local path dependencies used to test
  unreleased changes are never committed, here or in consumers.
- `README.md` is generated from `README.org` at release; never commit it.
- README images use absolute `raw.githubusercontent.com/.../main/doc/images/`
  URLs: never a version, a tag or `%%version%%` (nothing substitutes the
  README), and never relative paths (npm rewrites them unreliably).
- `npm run check` clears `dist/`; do not run it concurrently with another build.
- Site sources live in `site/`, built by `npm run site:build`; the Pages workflow publishes on release tags (or manual dispatch).
  Never package the site; documentation facts must come from the sources.

## Demo

- The demo lives in `demo/` and must never be packaged. Keep it and `doc/`
  outside the npm package allowlist and the library declaration build.
- Exercise every user-facing feature through the public built package,
  including its separate stylesheet and the frame helper. Render pane content
  generically through the pane slot and controller lists; never duplicate
  fixed panes in demo markup.
- Keep real-browser `demo:test` acceptance in `check`, including native CDP
  touch input, fresh storage, blocked external requests and resource cleanup.
- Regenerate README images and clips under `doc/images/` only with
  `npm run demo:capture` when visible behaviour changes; do not hand-edit them.
