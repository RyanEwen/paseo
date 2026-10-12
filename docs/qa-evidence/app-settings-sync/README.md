# App settings sync QA

The final isolated browser case passed with two independent clients. It verifies explicit
initialization, shared preferences, Usage visibility after reload, and read-before-write
switching to an initialized host. The fixture includes the approved sidebar count preference
and its portable sync classification. See [qa-manifest.json](qa-manifest.json) for source and
image hashes, viewport dimensions, and the tested scope.

The five PNGs are direct browser screenshots. The desktop shared-preferences image caught a
transient waiting status; the compact image shows connected with no pending changes. Native
devices and Electron were not tested. Usage reports come from the existing test fixture.

All owned fixture listeners and daemon processes stopped after the passing case. The earlier
WSL interruption did not qualify that attempt; these images belong to the completed rerun.
