# Capture native startup errors for the smoke's own process when no renderer is available.
# UI Automation exposes message-box text that Electron does not send to stderr on Windows.
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$AppProcessId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $AppProcessId
)
$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    $condition
)

Write-Output "Startup windows for smoke process ${AppProcessId}: $($windows.Count)"
foreach ($window in $windows) {
    Write-Output "Window: $($window.Current.Name)"
    $elements = $window.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($element in $elements) {
        $name = $element.Current.Name
        if ($name) {
            Write-Output $name.Substring(0, [Math]::Min($name.Length, 12000))
        }
    }
}
