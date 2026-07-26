# Why This Package Exists

Babylon Lite gives applications GPU picking, but a complete interaction system needs more than an individual pick result. Real applications need clicks, double-clicks, hover transitions, drag sessions, pointer state, filtering, propagation control, error handling, and predictable cleanup.

`@litools/interacter` exists to provide that application-facing interaction layer for Babylon Lite meshes.

## The underlying problem

A browser pointer event happens synchronously, while Babylon Lite GPU picking resolves asynchronously. That difference creates several problems that every interactive application would otherwise need to solve itself:

- multiple picks can overlap and resolve in a different order from the original pointer events
- a pointer can move again before an earlier hover pick finishes
- sustained pointer movement can outpace drag-surface GPU readback
- a target can be removed while its pick is still pending
- a manager or scene can be disposed while GPU work is in flight
- pointer-down and pointer-up results must be compared before a click can be recognized
- browser coordinates must be converted to canvas-relative CSS coordinates at the time of the original event
- decorative, unregistered geometry should not prevent an intended target from being picked

Calling `pickAsync` directly from several event handlers spreads this coordination across application code. It becomes easy to accidentally run concurrent picker requests, dispatch stale hover results, emit a click for mismatched targets, or retain listeners and GPU resources after disposal.

## One interaction owner

Interacter gives one manager ownership of interaction for one scene/canvas pair. That manager owns a basic Babylon Lite GPU picker and, when detailed picking is requested, lazily creates a separate detailed picker. Requests across both are serialized so GPU reads cannot overlap through the manager.

Discrete pointer-down, pointer-up, and context-menu requests keep their FIFO order. Hover work is different: only the newest queued pointer position matters, so obsolete positions are coalesced and stale results are ignored. Drag work also coalesces unsent positions, but its completed in-flight result remains useful and is delivered during sustained movement. Drag picks start immediately and take priority over frame-throttled hover work.

This division preserves meaningful button-event ordering without forcing the picker to process every intermediate pointer position or allowing continuous movement to starve drag updates.

## Drag semantics and latency

A drag session begins only after the initial pointer-down target has resolved and movement exceeds the configured threshold. Interacter can capture the pointer, ignores the dragged identity by default, and applies a separate filter to drag surfaces. This allows an unregistered ground, terrain, or placement mesh to guide a registered target.

Drag events preserve two identities. The event's target fields always describe the object being moved, while its picked fields describe the surface currently under the pointer. Keeping those identities separate is particularly important for thin instances, where a stable application ID may differ from the renderer slot and the surface can be another mesh entirely.

GPU surface resolution remains asynchronous. Interacter removes avoidable scheduling delay by starting drag picks immediately, prioritizing them over hover, delivering each completed in-flight result, and retaining only the newest unsent pointer sample. Applications therefore receive drag updates at the device's GPU pick-completion rate. Exact face and barycentric details require detailed picking and may cost more than point-only dragging.

## Interaction semantics above raw picking

A raw pick says which mesh was found at one position. Applications generally need a higher-level answer.

Interacter recognizes a click only when:

- the primary button was used
- pointer down and pointer up resolve to the same registered, live target
- movement stays within the configured device threshold
- the interaction finishes within the configured duration
- the pointer session was not cancelled

It also recognizes matching double-clicks and produces ordered hover transitions. When hover moves from one target to another, the earlier target receives `hoverend` before the new target receives `hoverstart`.

These rules are centralized so different parts of an application do not implement slightly different notions of a click or hover.

## Registered targets instead of every visible mesh

Interacter picks registered meshes only by default. Backgrounds, effects, helpers, and decorative geometry therefore do not swallow application interactions merely because they are visible.

Registration also creates a stable interaction target with an explicit lifecycle. Disposing a target removes its subscriptions, invalidates pending results for that target, and ends its hover state when necessary.

An optional filter can further restrict registered meshes without changing registration ownership.

## DOM state remains DOM state

Interacter snapshots pointer IDs, buttons, modifier keys, timestamps, and canvas-relative coordinates synchronously from the original browser event. It does not pretend that an asynchronously delivered interaction event is still a live DOM event.

For that reason, Interacter does not expose a synthetic `preventDefault()`. Native context-menu and pointer-default policy is configured on the manager and applied synchronously when the browser event arrives.

The package also avoids imitating the complete DOM capture and bubbling model. Target listeners run first, manager-wide listeners run second, and `stopPropagation()` can prevent manager-wide delivery. This is enough for scene interaction without introducing an artificial element hierarchy.

## Predictable failure and cleanup

Listener failures are reported through the manager's `onError` callback and do not prevent later listeners from running. Genuine picker failures use the same reporting path.

Disabling or disposing a manager invalidates obsolete work and clears pressed and hover state. DOM listeners are removed immediately on disposal, while the picker itself is released safely after any active request settles.

The goal is that an application can treat cleanup as a normal lifecycle operation rather than coordinating every pending promise itself.

## Why this is separate from Instancer

`@litools/interacter` is deliberately an independent package. Version 0.2 supports stable thin-instance ID resolvers while still importing or modifying neither `@litools/instancer` nor application state. The optional concrete adapter remains owned by `@litools/instancer/interacter`.

The mesh interaction model needs to be reliable before another target-resolution system is added. Keeping the first version focused lets scheduling, click recognition, hover transitions, propagation, and disposal be tested without coupling those semantics to instance-slot resolution.

The initial regular-mesh interaction core was proven before stable-ID resolution and the Instancer-owned adapter were added, preserving the dependency direction and lifecycle boundaries described here.

## Version 0.1 boundaries

The first version includes mesh and thin-instance-aware pointer, hover, click, and drag behavior. It intentionally does not include selection state, keyboard or gamepad input, React bindings, public adapter APIs, or direct Instancer ownership.

Those features can build on the interaction core later. They should not make the foundational pointer and picking behavior harder to understand or less deterministic.

In short, this package exists so Babylon Lite applications can work with reliable mesh interaction events instead of independently rebuilding asynchronous GPU-picking coordination, click recognition, hover and drag state, and resource cleanup.
