# Native browser replacement feasibility

## Deferred release scope

The selected release retains the resident Electron `<webview>` browser. It excludes
the WebContentsView replacement, separate-engine experiments and practical Chrome
extension support. Electron and its bundled Chromium remain part of the desktop app.
The [architecture](architecture.md) and [capture harness](browser-capture-harness.md)
describe the retained browser; this document records deferred research.

Research was reviewed October 14, 2026 in `feat/bundled-chromium-browser`, based on
`ca7b208057bf90fe85b7eaee6df867358ed99905`. The prototype record is
`qa-evidence/native-chromium-embedding/verification.md`.

Historical receipt identifiers below refer to owner-local records unavailable in
this release source. Their reported results and failures concern deferred research
and do not establish current release qualification.

## Previously approved research direction

Ryan approved VS Code-style **WebContentsView** as the research direction, with
focused background-rendering and practical-extension checks. That approval does not
select its source for this release. A separately managed Chromium process, CEF and
OWL remain research alternatives.

Before any later integration, preserve Paseo's pane appearance, tab/workspace identity,
human/agent ownership, x64 and native ARM64 support. Use Microsoft's ownership,
geometry, visibility, keyboard, session and CDP implementation as the reference.
The earlier partial fixtures do not establish that VS Code's complete implementation
fails. No WebView2 switch, shell rewrite or screenshot/video pane is approved.
A temporary screenshot placeholder during overlapping menus requires its own decision.

The deferred extension target is broad practical compatibility. Installation, worker
and storage behavior, restart, updates, popups and ordinary extension UI need separate
acceptance. Record individual incompatibilities; changing the view type does not
remove Electron's extension API limits. The research catalog and compatibility hooks
are excluded from the selected release along with the native-view source.

The remaining sections preserve source research and distribution alternatives.
CEF artifact metadata is not a selected or downloaded product dependency. Proposed
experiments and resource estimates below are historical plans, not execution grants.

## Architectural findings from the research review

| Claim                                                                              | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron `BrowserWindow(parent)` plus a persistent extension session recreates OWL | Incorrect. Electron documents a limited extension API, unpacked loading and explicit reload on app startup. `parent` creates another window; it does not turn it into a pane or change the extension runtime. [Extensions](https://www.electronjs.org/docs/latest/api/extensions), [window ownership](https://www.electronjs.org/docs/latest/api/browser-window#parent-and-child-windows).                                              |
| Atlas is ordinary Chromium window reparenting                                      | Unsupported. OpenAI describes a separate Chromium host, custom Mojo bindings and a client service layer. Its documented macOS path embeds a delegated CALayer using private CALayerHost and translates input in the client. Popup widgets also need delegated surfaces. The article does not establish a Windows WinUI implementation or provide a reusable OWL SDK. [OWL](https://openai.com/index/building-chatgpt-atlas/).           |
| CEF Chrome bootstrap makes Alloy equivalent to Chrome style                        | Incorrect. Chrome bootstrap and runtime style are distinct. The maintainer reserves Chrome UI extension functionality for Chrome style; some RequestContext-level extension behaviour can work in Alloy. [Migration](https://github.com/chromiumembedded/cef/issues/3685), [extension UI boundary](https://github.com/chromiumembedded/cef/issues/3859).                                                                                |
| CEF accelerated off-screen rendering solves this while retaining broad Chrome UI   | Not established. Current runtime source forces Alloy for windowless rendering. GPU handles do not restore missing Chrome browser UI. [Runtime source](https://github.com/chromiumembedded/cef/blob/master/include/internal/cef_types_runtime.h).                                                                                                                                                                                        |
| Electron has no GPU texture import interface                                       | Incorrect. Its experimental sharedTexture API imports platform handles and exposes VideoFrames. This is a possible composition building block, not a selected pane implementation or proof of extension, input, popup or accessibility fidelity. The VideoFrame presentation route requires an explicit product decision under the no-streaming constraint. [sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture). |

Unbranded Chromium's Google-specific identity/sign-in restrictions remain actual
compatibility limits. They no longer block research on a perfection requirement.
They must remain visible in extension results, especially
`chrome.identity.getAuthToken`. Website Google login is a different test from
browser sign-in or extension token acquisition. [Chromium API restrictions](https://www.chromium.org/developers/how-tos/api-keys/).

## Little Launcher comparison

Read-only source: `/home/rewen/development/little-launcher`, HEAD
`8df64154d243d91b83b9c08b077e2bdf0195542e`. Source inspection does not qualify its
running installation or prove every extension works.

| Local evidence                                                                                                          | What it establishes                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md:60`, `LittleLauncher/Windows/WebFlyoutWindow.cs:2281`                                                        | Windows WinUI 3 with Edge WebView2, not Electron. Web launchers use explicit user-data folders. Its Evergreen runtime policy is different from Paseo's required bundled engine.             |
| `LittleLauncher/Services/BrowserExtensionService.cs:19` and `:529`                                                      | The host owns a settings catalog, archive unpacking and reconciliation through `Profile.AddBrowserExtensionAsync`; profiles receive their own installed set.                                |
| `LittleLauncher/Services/BrowserExtensionService.cs:355`                                                                | Store-ID retrieval uses a custom CRX endpoint request with a fixed product-version parameter. This is not proof of automatic extension updates or a reusable browser-store contract.        |
| `LittleLauncher/Services/BrowserExtensionService.cs:477` and `LittleLauncher/Windows/WebFlyoutWindow.Extensions.cs:408` | Manifest action metadata supplies popup paths. The host opens `chrome-extension://` documents through its own ExtensionPopupWindow. Native browser-action UI is not supplied automatically. |

Microsoft's API installs an unpacked extension into a profile, persists that
installation, and requires extensions to be enabled. Extension files remain in
the source folder; changing their contents can remove the installed extension.
An update therefore needs a qualified lifecycle, not an in-place file overwrite.
[Installation contract](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2profile.addbrowserextensionasync),
[extension object](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2browserextension).

Use Little Launcher as a behavioural reference for installation, profile choices
and action affordances. Do not transplant its WebView2 backend, infer universal
Chrome compatibility, or copy its fixed-version download request as an update
implementation. Its observed user success is useful evidence for the practical
compatibility target; the source still contains host integration work.

## VS Code comparison

The current integrated browser is distinct from the old simple-browser iframe.
Microsoft's [architecture source](https://github.com/microsoft/vscode/blob/main/.github/skills/integrated-browser/SKILL.md)
describes a main-owned Electron WebContentsView, renderer model/layout proxies,
and shared-process Playwright reaching proxied CDP. Native views paint above the
workbench DOM. Overlays can hide the native view and temporarily show a screenshot
placeholder; that is not automatically compatible with Ryan's pane constraints.
Isolated-world preload code explicitly routes keyboard commands. Reuse these
ownership, geometry, session, sharing and input conventions regardless of the
selected engine; they are useful beyond a Chromium distribution decision.

The actual [BrowserView source](https://github.com/microsoft/vscode/blob/main/src/vs/platform/browserView/electron-main/browserView.ts)
uses WebContentsView and `capturePage` with `stayHidden`, a hidden-view visibility
pulse and bounded UnknownVizError retries. Its focus method normally refuses to
focus a view unless the host window is focused. This is relevant implementation
practice, not a guarantee for all minimized/background conditions. The owner's
earlier native comparisons (`qa-evidence/browser-focus/verification.md`) already
record Windows hidden resize/reload failures; those fixtures were not tests of
VS Code itself.

Inspected `browserView.ts`, `browserViewMainService.ts` and
[browserSession.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/browserView/electron-main/browserSession.ts)
contain Electron session ownership, but no Chrome-extension `loadExtension` path.
This scoped negative finding does not prove absence throughout VS Code or every
Microsoft Electron patch. Its [Electron packaging source](https://github.com/microsoft/vscode/blob/main/build/lib/electron.ts)
can fetch product builds from Microsoft's feed; feed configuration is not proof
of a Chrome extension compatibility patch. No such patch was established in the
inspected paths. VS Code extensions that receive browser/CDP APIs are not Chrome
extensions. Browser automation success therefore does not qualify password-manager
popups, MV3 workers, Web Store installation or extension updates.

WebContentsView plus the deferred catalog and compatibility hooks was the
lower-complexity comparison candidate. It could cover a useful subset of
the practical corpus, but source inspection cannot establish how much, and it
continues using Electron's engine and documented extension subset. It also needs
background capture and popup/overlay qualification. A later integration must test
the practical corpus rather than infer compatibility from the view type or an API
list. The proposed first implementation did not require a separately distributed engine.

## Platform and distribution matrix

CEF's project source recognizes `windows64`, `windowsarm64`, `macosx64`,
`macosarm64`, `linux64` and `linuxarm64`. This establishes supported source/build
selection, not the existence or freshness of a particular downloadable artifact.
Its sample project's CEF 144 pin is an example, not a current stable selection.
[Platform selectors](https://github.com/chromiumembedded/cef-project/blob/master/CMakeLists.txt),
[native ARM64 build instructions](https://github.com/chromiumembedded/cef-project/blob/master/README.md).

| Platform             | Frozen owning baseline release lane                       | Native Chrome-style candidate                        | Qualification status                                                                                                     |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Windows x64          | Packaged                                                  | CEF external native parent documented                | Source only; cross-process input and popup behaviour unverified                                                          |
| Windows ARM64        | Packaged; current release smoke is x64                    | Same CEF API, ARM64 project supported                | Required native execution, binary architecture and sandbox proof still pending                                           |
| macOS x64 / ARM64    | Both packaged                                             | Custom native GPU service bridge needs investigation | CEF source forces Alloy when `parent_view` is set; a foreign process NSView pointer is not a portable embedding contract |
| Linux x64            | Packaged                                                  | CEF Chrome-style external native parent on X11       | Source only                                                                                                              |
| Linux ARM64          | Existing prototype; no ARM64 release job in this checkout | Same X11 candidate                                   | Previous stock Chromium attachment painted but keyboard containment failed; software llvmpipe only                       |
| Linux native Wayland | No separate release artifact                              | No arbitrary X11 parent-window assumption            | Surface integration unproved; do not silently make XWayland a product requirement                                        |

Sources: [CEF modes](https://github.com/chromiumembedded/cef/issues/3685),
[macOS parent restriction](https://github.com/chromiumembedded/cef/blob/master/include/internal/cef_types_mac.h),
`.github/workflows/desktop-release.yml`, `packages/desktop/electron-builder.yml`.

The release-lane column describes this owner's frozen baseline, not the newer
root release matrix. Root has newer Linux ARM64 release work; it was not audited
as part of this old checkout and must not be inferred from this table.

### Bounded registry and Windows toolchain verification

On October 14, official registry HEAD returned 10,514,265 bytes and ETag
`38410c975fbd81837975a9528857de16`. Bounded HTTP ranges using that ETag found the
first stable entry for both Windows architectures: **CEF 150.0.22+gc1a097e,
Chromium 150.0.7871.256**. This is the latest stable entry observed in that registry,
not a claim that its Chromium version is the latest release or has every security
fix. Metadata/source response bodies consumed 1,472,077 bytes, excluding small
HTTP headers and local toolchain receipts. No archive body was requested.

| Candidate     | Standard compressed bytes | Minimal compressed bytes | Standard published SHA-1                   |
| ------------- | ------------------------- | ------------------------ | ------------------------------------------ |
| Windows x64   | 347,007,937 (330.93 MiB)  | 164,266,201 (156.66 MiB) | `598bf2224d04ffd07f1e430ccaf33e5f44766ae6` |
| Windows ARM64 | 323,556,356 (308.57 MiB)  | 158,787,794 (151.43 MiB) | `7f128dbed8e4c5bc20e10d38400034bdbd7a2f57` |

All four archive HEAD requests returned 200 and matched registry compressed sizes.
The standard archives' tiny `.sha1` companions matched registry digests. These are
verified published metadata, not recomputed binary checksums or inspected PE
architectures. Unpacked footprint, bootstrap inventory and signed binary contents
remain unknown. Do not infer an admission budget from compressed size alone.

Exact URLs, registry entries, HEAD receipts and pinned API-source hashes are in
metadata receipts (`qa-evidence/native-chromium-embedding/cef-metadata-2026-10-14.json`).
Source headers read at CEF revision `c1a097e` confirm the same runtime-style,
macOS parent restriction and DevTools observer/method API used in this report.
The experiment should use that version's API instead of mixing master headers
with a released binary. Full ABI qualification still needs the selected package.

Existing Windows files/installation records establish Visual Studio Community
2022 **17.14.37502.11**, MSVC tools directory **14.44.35207**, native ARM64-hosted
ARM64 and x64 `cl.exe` files **19.44.35228.0**, CMake **3.31.6-msvc6**, and Windows
SDK directory **10.0.26100.0** with `rc.exe` file version **10.0.26100.7705**.
No compiler/CMake command ran. Environment activation, linking, sandbox bootstrap
compatibility and executable output are not qualified. Existing BuildTools has
version 17.14.37411.7; do not silently mix that instance with Community inputs.

A future separate-engine release would need one pinned engine manifest with platform, native architecture,
version, source URL, upstream digest and independently recorded SHA-256. Package
the engine/resources physically outside asar, with no first-run download or
system-browser fallback. Verify signed/notarized final bundles and subprocess
layout. Keep CEF/Chromium and third-party notices; inspect the selected archive's
licenses instead of assuming one BSD file covers every binary component.
[CEF license](https://github.com/chromiumembedded/cef/blob/master/LICENSE.txt),
[distribution layout](https://chromiumembedded.github.io/cef/general_usage),
[signing](https://chromiumembedded.github.io/cef/code_signing.html).

## Earlier separate-engine experiment, not selected

Before the native-view approval, the bounded candidate was a separate CEF
**Chrome-style component**, retaining Electron. Preserve this as research history;
no CEF experiment is included in this release. On
Windows ARM64 it offers a documented native-parent and extension runtime route
without immediately building a custom Chromium fork. Cross-platform approval
cannot follow from that one-platform pass, particularly on macOS.

The alternative with the clearest conceptual match to OWL is a maintained
Chromium fork with browser/profile/extension services and delegated GPU/input
interfaces. That preserves upstream browser semantics but adds browser-fork,
per-platform composition, signing and security-update maintenance. Ordinary OS
reparenting remains a diagnostic technique with a recorded keyboard failure.

The earlier component proposal required these steps; they are not admitted for this release:

1. Pin one current native ARM64 standard CEF distribution and its exact API source.
   Use its Windows sandbox bootstrap plus a small client DLL. Create one native
   Chrome-style child at an explicitly supplied Electron HWND. No external
   browser window, image transport or hidden Alloy fallback. Confirm whether
   the API supports the cross-process parent configuration in this actual build.
2. Keep a separate supervisor/profile and a private authenticated local control
   channel. RequestContext and browser identifiers stay engine-owned. Provide a
   deterministic mapping to Paseo browser/workspace IDs, independent of UI focus.
3. Exercise two browser instances and the extension corpus below. Record which
   native Chrome UI affordances remain, and whether they fit the existing Paseo
   pane without duplicate browser chrome or a materially changed workflow.
4. Stop on keyboard leakage, unsolicited window creation, forced Alloy style,
   sandbox disablement or a missing pinned ARM64 binary. Preserve receipts; do
   not substitute an external window, bitmap pane, profile recreation or emulation.

Current CEF sandbox documentation uses prebuilt bootstrap executables with a
client DLL on Windows from M138 onward. An old static-library recipe is not the
current third-party embedding path. Keep sandboxing enabled.
[Sandbox contract](https://github.com/chromiumembedded/cef/blob/master/docs/sandbox_setup.md).

CEF exposes DevTools commands/observers without an open DevTools UI or remote
debug session. A broker can carry those responses over the private channel;
there is no reason to introduce an unauthenticated debugging port. Keep the
existing CDP framing/cancellation policy where applicable, without assuming
stock `--remote-debugging-pipe` is automatically the right CEF transport. Custom
Mojo is justified only when new engine-side services are needed, not just to
rename CDP. [DevTools API](https://github.com/chromiumembedded/cef/blob/master/include/cef_browser.h).

## Deferred integration acceptance gates

| Area                 | Required evidence                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native presentation  | Inspect separate process ownership and native parent/compositor surface. Change content and sample painted pixels in the actual host pane. Screenshot transport is evidence only, never presentation.                                                                                                                                                                    |
| Background rendering | Fresh independent top/bottom markers beyond host dimensions; exact CSS viewport and physical scale after opening, navigation, reload and resize. Repeat with inactive pane/workspace, hidden host and verified minimized host. No host animation-frame dependency or foreground leases.                                                                                  |
| Keyboard and input   | Trusted click/type/wheel/held gestures. Seed host typing, run automation and type again; all keys stay with the human target. Repeat with another application and IME composition. Window-focus IDs alone do not pass.                                                                                                                                                   |
| Extension corpus     | Test an owned MV3 probe plus current versions of a password manager, content blocker, page annotator/user-script tool, developer extension and tab-management extension. Include a native-messaging/OAuth case as a separately reported capability. Record publisher, ID, version, source and permissions; choose exact packages only after registry/store verification. |
| Extension behaviour  | Popup/action context and activeTab identity, content scripts, cross-frame injection, scripting/tabs/events, worker idle wake/restart, alarms, local/session storage, request rules and permissions. Install, disable/enable, restart, update and removal must be independent receipts.                                                                                   |
| Store and updates    | Complete one real Web Store installation with consent and stable ID/signature; preserve version/storage through restart; test a controlled signed update independently. An unpacked probe is not Web Store/update proof. Preserve the existing disabled choice and review permission expansion.                                                                          |
| Native UI fidelity   | Popups/select/context menus, keyboard accelerators, clipboard, drag/drop, screen-reader tree, IME, permissions, file upload/download dialogs and DevTools. Browser-created surfaces stay in the intended host workflow.                                                                                                                                                  |
| State                | Keep unsaved drafts through presentation changes; preserve fresh-profile login/cookies/storage and extension state. Never open an Electron profile concurrently in Chromium. Any production migration requires explicit reversible export/import and a retained source profile.                                                                                          |
| Ownership/recovery   | Concurrent capture/input, cancellation and stale target rejection, human/agent control transitions, browser crash, host view destruction, shutdown and engine update. Never replay a mutation with unknown outcome or silently recreate a tab.                                                                                                                           |
| Security/package     | Sandbox active, no public/debug TCP listener, peer-scoped private channel and bounded handles/messages, verified native ARM64 executable, complete bundled resources and notices, no first-run download. Revoke native handles and await owned subprocess exit.                                                                                                          |

Broad compatibility means recording an extension-by-extension result matrix,
not declaring success from one content script. Capture extension popup pixels
alongside the page when agents need them, while preventing agent shortcuts from
controlling privileged host/browser UI. Ordinary compatibility failures remain
visible for Ryan to judge.

## Historical resource admission

No builds, browser runtime, binary downloads, installs or dependency copies ran
in this research pass. Read-only registry/HEAD/API-source metadata and existing
Windows file versions were verified under the later bounded allowance. Existing prototype, files and live tabs are untouched.
The original research did not qualify a release candidate. The resource proposal
below is not an active allowance. Follow the current
[worktree guide](worktree-development.md) for source selection and admission.

For the first prebuilt-component experiment, propose a **4 GiB maximum growth**
and one two-CPU validation slot. This is an admission ceiling, not an observed
artifact size: verify compressed size, unpacked inventory and predicted build
output before granting it. Admit only one architecture, no symbols, no duplicate
node_modules, and reuse reviewed immutable inputs. If it cannot fit, request a
revised budget before extraction. Do not spend the remaining C: space based on
Linux's virtual free-space figure.

A Chromium source build is outside that budget. Upstream Windows instructions
require at least 100 GB free disk; CEF's automation guidance lists 200 GB for its
macOS build configuration. Use a dedicated native builder for a fork experiment,
with measured archives/outputs and an update/rebase owner.
[Chromium build requirements](https://chromium.googlesource.com/chromium/src/+/main/docs/windows_build_instructions.md),
[CEF automation requirements](https://github.com/chromiumembedded/cef/blob/master/docs/automated_build_setup.md).

Provisional engineering estimates, not measured commitments: allow 2-5 engineering
days for a single-platform component spike after toolchain admission, 2-4 weeks
for cross-platform feasibility, and several months plus continuing security
maintenance for a custom browser-service fork. Re-estimate after artifact,
sandbox, native surface and input gates; do not commit to production costs from
this source review.

The deferred native-view owner recorded focused static qualification and a basic
Linux ARM64 actual React pane milestone. The historical evidence below does not
qualify the retained webview candidate or clear the remaining cross-platform gates.

## Historical native pane qualification

The basic Linux ARM64 milestone passed with Electron 44.5.1, Chromium
152.0.7977.130, host zoom 1 and device pixel ratio 1. The owner connected its main-owned
WebContentsView to the actual React browser pane. That recorded milestone preceded
the later combined preview assembly. This release candidate excludes that source;
the receipts do not establish installed-app or current candidate behavior.

| Area                      | Qualified evidence                                                                                | Boundary                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Actual pane               | Real XGetImage host paint, owned view identity, navigation URL/title/loading                      | No DOM webview or image/video presentation                                 |
| Full viewport             | Fresh 1920 by 1080 CSS/physical frame beyond the host window                                      | Zoom 1, DPR 1                                                              |
| Inactive workspace        | Fresh changed 412 by 915 frame with the same page and unsaved draft                               | Native view hidden; selected workspace unchanged                           |
| User input during capture | Native baseline `a`, then distinct capture-phase `b` delivered to the selected host input as `ab` | Injected DOM receiver proves a hit/focus primitive, not composer workflow  |
| Observed spill            | No pixel change in 29,821 two-point samples over 1.620 seconds during capture                     | Largest sample gap 8.185 ms; finite coverage, not every native-layer event |
| Return and close          | Same contents 2 and draft on return; original and background tab closure/destruction              | One isolated journey, no live tab recreation                               |
| Hidden host baseline      | Fresh oversized 672 by 1497 and 1008 by 2246 frames, draft/cookie retained                        | Separate earlier fixture; restart and true minimization remain open        |

See the frozen real-pane qualification (`qa-evidence/native-react-pane/receiver-admission/split-runtime/qualification.json`),
source hashes (`qa-evidence/native-react-pane/receiver-admission/split-runtime/source-manifest.json`)
and exact owned teardown (`qa-evidence/native-react-pane/receiver-admission/split-runtime/teardown.json`).
Seven recorded processes and five dynamic ports retired, including both observers
and the authenticated private display. Peak incremental storage was 193,460,688
bytes, below the admitted 256 MiB ceiling. The source packet is retained under
`.dev/native-browser-handoff`; its metadata identifies the owning base, paths,
dependency provenance and qualified evidence. It excludes duplicate binary evidence.

The capture function primes hidden native views with adjacent synchronous
`setVisible(true)` and `setVisible(false)` calls, then `capturePage` with `stayHidden`.
There is no await/yield between the setters or host activation. Existing capture
queues and guarded explicit focus remain unchanged. The measured key dispatch
coincides with the capture request, not a guaranteed instant inside those setters.
These fixtures do not diagnose Ryan's live keyboard-focus losses.

## Preserved failure evidence and implementation constraints

Keep earlier receipts when reviewing the accepted milestone. They establish the
limits that the focused changes and fixture admission corrected:

| Evidence                                                                                                                                                                                | Constraint recovered                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native admission (`qa-evidence/native-view-runtime/qualification.json`)                                                                                                                 | Main must bind the exact creator/view/contents/session identity; Electron reports this WebContentsView as type window                                     |
| Unprimed geometry (`qa-evidence/native-view-geometry/qualification.json`)                                                                                                               | Assertions before the existing production capture priming overstated a never-presented view failure                                                       |
| Primed hidden baseline (`qa-evidence/native-view-primed-hidden/qualification.json`)                                                                                                     | Exact dimensions plus changed top/bottom pixels qualify the actual production capture path                                                                |
| Parent composition failure (`qa-evidence/native-parent-clip/qualification.json`) and reparent pass (`qa-evidence/native-parent-clip-reparent/qualification.json`)                       | Attach the bounded parent before automatic same-widget reparenting; the direct-paint precondition changed too, so ordering alone is not an isolated cause |
| Real-app setup failures (`qa-evidence/native-react-pane/results.json`)                                                                                                                  | Short private temporary paths avoid Chromium's Unix socket length limit; bundle readiness precedes the unchanged UI readiness gate                        |
| Inactive native bounds (`qa-evidence/native-react-pane/xlib-admission/qualification.json`)                                                                                              | A resized child wholly outside its retained clip can retain stale renderer size; hidden full viewport placement now intersects its native ancestors       |
| Failed input gate (`qa-evidence/native-react-pane/hidden-geometry-fix/qualification.json`) and baseline (`qa-evidence/native-react-pane/receiver-admission/runtime/qualification.json`) | Native click/key batching lacked Chromium click-focus settlement; observe actual trusted click and main focus before the one key                          |

The earlier separate Chromium X11 prototype and private-pipe foundation remain
in the branch. Its keyboard containment failure is still recorded. They are
historical alternatives, not the selected native pane implementation.

Focused static qualification covers the changed main ownership, IPC/profile and
renderer proxy/selector paths. The final hidden placement change passed 22 tests in
the existing ownership suite, targeted lint, desktop typecheck and owning main
build. The succeeding receiver journey changed fixtures only; green production
checks were not repeated. Native crash/shutdown source tests are separate from an
actual runtime crash/recovery or update test.

## Historical independent remaining gates

Next acceptance preparation (`qa-evidence/native-react-pane/next-acceptance.md`)
owns the source audit and practical extension corpus. Independent page zoom and
exact device CSS presets are approved. The corrected native zoom fixture (`qa-evidence/native-next/independent-page-zoom-oracle/runtime/qualification.json`)
passed at host zoom 1.25 and observed page zoom one: exact 672 by 1497 CSS/native
DIP/physical pixels, fresh top/bottom markers beyond the host, native crop, painted
clipping and trusted inside/outside input. Capture preserved host/page focus and
native identity. This uses a synthetic anchor, so actual React frame centering,
shadow and draft retention at nonunit zoom remain separate gates.

The source slice (`qa-evidence/native-next/zoom-policy/qualification.json`) passed
19 selected native/renderer cases, targeted lint, desktop/app typechecks and owning
main build. The old 840 by 1871 failure (`qa-evidence/native-next/zoom/qualification.json`)
and obsolete rounding assertion (`qa-evidence/native-next/independent-page-zoom/runtime/qualification.json`)
remain preserved. The corrected fixture uses independent inward clip edges and
rounded absolute origins. No zoom reset, emulation, image rescaling or wider input
tolerance was introduced. Sampling and cleanup limits are in the runtime receipt.

The native profile restart pair (`qa-evidence/native-next/context-menu/runtime/qualification.json`)
passed through the production native owner on Linux ARM64. Repository-owned MV3
content scripts, popup documents, local storage, tab/frame identity, resource and
permission boundaries, worker wake/events, real 110-second worker traffic/idle
observation and alarm wake passed. Cookies, page storage, extension storage and
catalog state survived the separate write/read processes in a fresh owned profile.
One private OS right-click per phase produced a real Electron context-menu request;
the existing action/worker assertions then passed and prior geometry was restored.

This qualifies fixture extension documents and native input, not the actual React
extension toolbar, overlapping app menus, third-party extensions, Store downloads
or updates. Catalog auto-update remains disabled. See the linked qualification for
finite focus observations, warnings and cleanup. Earlier document-start selection
and hidden-context-input failures remain in the evidence history; their corrected
fixture ordering/presentation does not establish a product focus defect or fix.

The next native fixture gates (`qa-evidence/native-next/minimized-scale/admission.md`)
separate actual private-WM minimization from flag-based observed DPR 1.5; neither
has run. The publisher proposal (`qa-evidence/native-next/third-party/proposal.md`)
records one unchanged third-party artifact and concrete API risks before any download.
The overlap source plan (`qa-evidence/native-next/menu-overlap/source-plan.md`) follows
the canonical overlay registrations and approved blank-on-failure policy.

Source preparation and runtime execution need separate admission. Extend existing
ownership/capture/profile suites and harness groups; do not create another test
framework or repeat unchanged green cases.

| Gate                          | Required evidence                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host/page zoom and DPR        | Distinct host CSS, native DIP, page CSS and physical PNG units; preserve the preset and real native hit/crop fidelity without emulation or silent scaling                   |
| Practical extensions          | Actual persistent-session content scripts, workers/storage, tab/frame identity, popup UI and catalog lifecycle; report each unsupported API and third-party incompatibility |
| Real overlapping UI           | Ryan approved a fresh still frame, or blank browser area on capture failure, only during menu overlap; same-page restoration remains unqualified                            |
| Native platforms              | Windows x64 and native ARM64, macOS and supported Linux lanes require their own execution/package receipts                                                                  |
| Minimized and device scale    | Independently observe real minimization and native display scale, including 150% Windows scale                                                                              |
| Remaining lifecycle/workflows | Concurrent capture/input cancellation, crash/recovery, restart/update/shutdown, DevTools, permissions, downloads/uploads, keyboard containment, IME/accessibility/clipboard |

Keep the shared `persist:paseo-browser` profile. Any migration must be explicit,
safe and reversible. Existing extension popouts, consent dialogs and Store UI are
retained workflows and have not been newly qualified by the native pane milestone.
Do not attach a running old profile or control the user's persistent tab for QA.

The Microsoft copyright and MIT notice for adapted capture priming are retained
in source and desktop packaging resources. Packaging has not been built. The
opening fork README was reviewed; no completed native replacement claim was added.
