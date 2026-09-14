$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$testOutput = Join-Path $env:TEMP 'last-light-firmware-unit-tests'
New-Item -ItemType Directory -Path $testOutput -Force | Out-Null
$cases = @(
  @('-DLASTLIGHT_LED_MODE=0'),
  @('-DLASTLIGHT_LED_MODE=1'),
  @('-DLASTLIGHT_LED_MODE=1', '-DLASTLIGHT_LED_ACTIVE_LOW=1'),
  @('-DLASTLIGHT_LED_MODE=2', '-DLASTLIGHT_LED_SEGMENTS=16'),
  @('-DLASTLIGHT_LED_MODE=2', '-DLASTLIGHT_LED_SEGMENTS=16', '-DLASTLIGHT_LED_ACTIVE_LOW=1')
)
for ($caseIndex = 0; $caseIndex -lt $cases.Count; $caseIndex++) {
  $binary = Join-Path $testOutput "firmware-$caseIndex.exe"
  & g++ -std=c++17 -Wall -Wextra -I (Join-Path $projectRoot 'arduino/tests') @($cases[$caseIndex]) (Join-Path $projectRoot 'arduino/tests/firmware.test.cpp') -o $binary
  if ($LASTEXITCODE -ne 0) { throw "Firmware test build $caseIndex failed." }
  & $binary
  if ($LASTEXITCODE -ne 0) { throw "Firmware test case $caseIndex failed." }
}
