# @0k/vue-split-tabs

Content-agnostic split-tab layout. The controller owns intent and effective
layout; components render it and handle gestures. Hosts own tab content, labels,
storage keys, routing, data, and themes.

## Rules

- Users may freely reorder tabs. Persist each page's custom `order`; all panes
  and collapsed layout use that effective order. Natural host order is only the
  default and the insertion reference for newly present ids: insert after the
  nearest already-placed natural predecessor, otherwise at the start. Keep absent
  ids in saved order; collapse, restoration and merge must not reset it.
- Persist intent, not effective layout. Size and tab-list changes never write
  storage or forget absent tab ids; collapse automatically restores when it fits.
  Materializing first-leaf membership must union saved assignments with current
  implicit membership, removing only the deliberately relocated id. Unrelated
  split/move actions and automatic promotion must retain absent assignments in
  every surviving owner leaf; only explicit merge resets all membership.
- Optional tabs are visible only when opened: visible = present non-optional ids
  union present opened ids. All layout and restoration use visible ids, not present ids.
  `open` on an already-visible tab only focuses it in its own pane, NEVER moves it.
  Persist `opened` per entry like `order`, retaining absent ids. Derived changes never write.
- `insert`/`insertSplit` require a present id and commit opening plus placement
  in one write. Visible ids use `place`/`splitAt` semantics (not focus-only `open`).
  An incoming hidden optional id can split off from one existing visible tab.
- `replace(oldId, newId)` is one atomic action, never close + open/select writes.
  A hidden present target takes the visible source's order slot, opened state and
  pane membership, preserving the shown tab unless the source was shown. Remove
  any older target position/membership. An already-visible target NEVER moves:
  dismiss the source, use normal history/last-tab merge rules, then focus the
  target in its own pane. Host placeholders that must disappear are optional ids.
- Explicit merge clears all pane membership. Removing the last visible tab from
  a pane removes that leaf; promote its sibling subtree with inner ratios intact.
  Opening a closed tab removes its old membership before assigning the destination;
  replacement removes the consumed source membership and transfers the slot as above.
  Preserve ratio, order and opened ids on merge. LRU eviction may forget an entry.
- The first RENDERED pane owns the host-active role, even when empty intent
  branches hide the original first leaf. Keep an already-empty host active id
  untouched on derived changes. Deep links into any rendered pane display there.
  A nonempty but unavailable host request falls back to a valid shown tab without
  changing host state, firstActive or storage; it is not an explicit empty request.
  When an action removes the linked tab/pane, repair host active and firstActive
  against the post-mutation tree in that action's one write. Never repair from
  pre-mutation pane selections or leave the surviving primary pane blank.
- Record `firstActive` only in controller user actions: primary selection and
  every host active setter call, in the same single intent write as the action.
  Never learn it from host navigation or derived size/tab changes. Explicit
  merge clears it; a merge-by-drop records the dropped id, a merge-by-move the
  tab the destination pane was showing. `restoredActive` is a
  host-consumed request, not an automatic host selection, and remains available
  for valid representative-leaf membership of the first rendered pane in split
  intent while collapsed for size.
  Splitting off or moving a tab other than the shown one records the shown tab as
  `firstActive`, overriding any older request.
- `moveTo(id, paneId)` puts the tab away: it goes behind the
  destination pane's shown tab, which stays shown, in both directions and after
  a merge. Only drag-and-drop (`place`) reveals the moved tab where it is dropped.
  Do not restore `moveToOther`: there is no unique other pane in a recursive layout.
- When the shown tab leaves its pane (split, move, cross-pane place, start-side
  split, close, replacement by an already-visible target), the replacement is the most recently viewed tab still in that pane,
  falling back to the order neighbor. The view history is memory-only, one per
  pane and entry key, cleared on key change, never persisted; it is learned only inside
  controller actions (the tabs shown when acting, and each tab the controller
  selects), never from host navigation between actions.
  Retire history when a leaf is explicitly removed; keep surviving leaves' history.
- The per-page intent table is bounded LRU; existing-entry reads and committed
  user actions bump monotonically increasing recency stamps.
- Refresh and validate shared storage before writing; replace only this
  controller's current entry and preserve other entries. Stamp with the maximum
  local/stored stamp plus one. Storage errors retain in-memory intent and pending
  writes; do not resurrect stale cached entries over newer persisted ones.
- Storage failures never break in-memory use; validate stored JSON at the boundary.
- Stored intent without `firstActive`, `order` or `opened` loads them as empty. Drop only invalid entries;
  duplicate keys keep the highest-stamp valid entry, not a whole-table reset.
- Keep content never remounts on pane moves, collapse, or restore. Use Teleport
  retargeting, never conditional mounting of the persistent content.
- Labels are always host-supplied; never introduce built-in visible strings.
- In every pane, split controls are direct per-orientation buttons for that pane's
  fitting axes, labelled by `rows` and `cols`. There is no implicit destination or
  directional move button. A host may disable all these buttons with
  `SplitTabStrip`'s `splitButtons: false` (default true). Keep controller labels
  required: labelled edge-drop shades still use rows/cols. Close, end-slot,
  drag/drop and keyboard reordering remain available. No orientation popup.
- Keep enabled icon buttons in layout and keyboard order on every tab. Reveal only on
  active, hovered or focus-containing items; hide with opacity/pointer-events,
  never display:none. Split/move glyph/hit sizes default to 18px/24px with stroke width 2.
- Close buttons require host `labels.close` and an optional tab. Put selection
  then close inside `.split-tab-strip-title`, BEFORE the split/move icons, never
  nesting buttons. Close defaults to a 10px glyph in an 18px hit box, stroke 2
  with round caps, 2px from the label; use the close-specific size/hit/gap variables.
  Keep the same reveal rules; close never selects or drags. The active background
  belongs to `.split-tab-strip-title--active`; keep the selection button's active
  class and aria-pressed too. Hosts can underline the combined title span.
- The strip `end` slot is sticky at the right edge, non-draggable, never a drop
  target and never an item for insertion midpoint/marker calculations. Centre its
  child vertically with flex alignment; expose optional end padding for host underlines.
  No wrapper without a slot.
- Do not add domain navigation, routing, fetching, or application themes.
- Pointer gestures use window listeners and clean up on up, cancel, and unmount.
  Tab dragging works in single and split layouts and cannot target another
  SplitTabs root. Internal mouse drags use a >6px threshold. Internal touch/pen must hold 350ms first;
  movement >6px before arming cancels drag and allows native scrolling. Clean up
  hold timers too. When touch/pen arms, register a non-passive window touchmove
  handler that prevents default while armed; remove that exact handler on every
  exit/unmount. Never rely on pointermove.preventDefault or changing touch-action
  after touch start to stop native panning. Never use HTML5 drag-and-drop.
- External drags use the SAME root drag instance, targets, ghost, listeners and
  cleanup, exposed as `SplitTabs.startExternalDrag`. The host owns the threshold
  or long press and hands over an already-armed pointer; never arm it again.
  Absent ids may preview targets. On a valid drop only, the optional synchronous
  `beforeDrop` hook registers the id through `insert`/`insertSplit`'s synchronous
  registration callback AFTER the controller captures the target projection and
  BEFORE applying placement. Registration must not turn the incoming id's default
  implicit membership into a real source, resurrect a hidden branch, invalidate
  fitting preview geometry, or prune another absent tab's owner.
  Cancellation, foreign roots and invalid drops never call the hook. The host
  owns source-row click suppression and any listeners used before handoff.
- Share transient drag state through the root context. Show a cloned-content
  ghost, midpoint-based strip insertion marker, fitting-edge half-pane shade for
  a new split, or destination-pane body shade plus end marker. No valid target means
  cancel. Escape/cancel/unmount remove ghost, previews and all gesture listeners.
- Strips scroll horizontally with nonshrinking items and nowrap selection labels.
  Tab buttons keep touch-action:pan-x; the armed touchmove handler cancels panning.
  Plain taps must still select. Markers are absolute in strip content coordinates,
  never viewport-fixed, and must account for scrolling and transforms.
- Use ordinary named selection buttons with aria-pressed, not tablist/tab roles
  containing non-tab action controls. Preserve host slot text as the accessible
  name; do not replace it with a technical id. Keep native button keyboard access.
- Selected buttons use split-tab-strip-tab--active, never a generic active class;
  keep aria-pressed. Alt+Shift+Left/Right reorders one slot within the focused
  button's strip without selecting it, and restores focus after the DOM move.
- Suppress only immediate pointer clicks (detail > 0) after mouse drags and expire
  the guard after the current task, even when no click is delivered. Never
  suppress keyboard activation (detail 0). Clear suppression timers on disposal.
- Same-pane `place` is pure reorder (current-slot drop is a no-op). Cross-pane
  placement combines order, membership and selection in one persisted write.
  `splitAt` creates a centred start/end split matching the half-pane preview;
  explicit `split` retains its saved-ratio behavior. Merges preserve order.
- Divider press/release without axis movement must not change or commit the
  ratio. Actual drag up/cancel commits once. Double-click and focused Enter
  equalize the maximal connected same-axis cut run among rendered cuts; preceding
  clicks never commit. Count only participating rendered segments and dividers:
  empty branches contribute neither, and a size-collapsed subtree is one segment.
  Keep hidden ratios intact and use EFFECTIVE segment minima at allocation AND
  final clamp: a collapsed pane contributes one pane minimum, not hidden cuts.
  Ordinary divider resizing still uses full intent minima. Persist once if changed.
- Intent is an unlimited-depth binary tree of stable-id pane leaves and cuts.
  Public pane arguments, contexts and drag targets use ids, never positions.
  The flat pane list is depth-first (first before second); index is display-only.
  The first leaf receives visible tabs not assigned to another leaf. Global order,
  opened ids and firstActive remain page-wide; history is memory-only by pane id.
  Never reuse node ids within a controller lifetime, including ids in loaded trees.
  Every action must leave intent membership unique across leaves and reloadable
  through the storage validator. Never copy a collapsed pane's combined membership
  into its representative leaf while retaining descendant assignments.
- Every pane body offers fitting edge thirds, even in nested layouts. Split the
  hovered pane, not the root; previews use its geometry. Strip slots and another
  pane's body centre reveal cross-pane drops. Split APIs accept a target pane id.
- Derive collapse top-down without changing intent or writing storage. Reserve
  at least one minimum pane per side so inner cuts collapse before outer cuts.
  A collapsed subtree lists all its tabs in custom order and shows its first
  leaf's shown tab; restore the exact tree when space returns.
- Divider clamps use full subtree minimums (sum plus dividers along the axis,
  maximum across it); pointer and keyboard resizing must not fold inner cuts.
  If full minimums cannot fit, reserve one minimum pane per side instead.
- Cache subtree tabs, representatives and minima in the controller's size-independent
  tree index. Resize passes reuse it. Components consume the controller's indexed
  cut projection; never search the whole effective tree per rendered container.
- `pane.fits` is geometric capacity, NOT split-action availability. A pane with one
  tab may fit an incoming tab but cannot split off its own only tab.
- Read legacy orientation/second/secondActive/ratio entries as equivalent trees;
  keep validation, LRU, stamps, and refresh-before-write semantics unchanged.
- Committing without measurement or fit preserves the normalized [0,1] request,
  not the display default. Collapse aborts a live resize without committing it
  and clears the live override so restoration uses committed intent.
- Use CSS custom properties with the `--split-tabs-` prefix and host class hooks.
  No 1px borders and no imposed palette or typography.
- Android System WebView 91 is the compatibility floor. Do not use newer
  runtime APIs without a compatible implementation; keep compatibility tests.
- Keep source lines readable (at most 160 characters). Write specification tests
  first and run `npm run check` before delivery, including the post-build artifact
  smoke test, consumer type probes, and real-browser acceptance. Build output is
  ESM-only with types/default exports; Vue stays external. CSS is explicitly
  copied/exported and must not be imported by the JavaScript/declaration entry.
  Clear dist before build so stale output cannot ship.
- Relative TypeScript-module imports use .js extensions. Published component
  types target moduleResolution:bundler; verify the strict NodeNext consumer
  probe but do not claim support while Vue SFC exports remain unresolved.
- Keep pinned Playwright browser acceptance in npm run check. Test the built
  artifact with real CDP touch input: hold-horizontal reorder must end on
  pointerup, hold-vertical must split, quick swipes must scroll without drag,
  and mouse ordering/keyboard activation must work. Synthetic pointer tests alone
  cannot validate the compositor's touch-action/pointercancel behavior.
- Releases are published publicly to npm with the `pkg` release workflow from
  a tagged commit; `package.json` keeps `%%version%%`, substituted from the tag.
- Release/tag/publish only with explicit authorization. Install release helpers
  with `pkg vendor`, never by hand-copying. Run `pkg check` for setup validation;
  keep the registry/github-release feature declarations and canonical changelog
  configuration.
- Consumers depend on the npm release. Local path dependencies used to test
  unreleased changes are never committed, here or in consumers.
- `README.md` is generated from `README.org` at release; never commit it.

## Demo

- The demo lives in `demo/` and must never be packaged. Keep it and `doc/`
  outside the npm package allowlist and the library declaration build.
- Exercise every user-facing feature through the public built package, including
  its separate stylesheet. Render pane content generically through the pane slot
  and controller pane list; never duplicate two fixed panes in demo markup.
- Keep real-browser `demo:test` acceptance in `check`, including native CDP
  touch input, fresh storage, blocked external requests and resource cleanup.
- Regenerate README images under `doc/images/` only with `npm run demo:capture`
  when visible behaviour changes; do not hand-edit the captures.
