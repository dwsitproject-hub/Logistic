# SAP UAT Status & Qty Delivery — API surface test
# Usage: powershell -File docs/test-reports/sap-uat-status-qty-api-test.ps1

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5001'
$loginBody = '{"username":"admin","password":"admin123"}'
$login = Invoke-RestMethod -Uri "$base/api/auth/login" -Method POST -Body $loginBody -ContentType 'application/json'
$token = $login.data.token
$headers = @{ Authorization = "Bearer $token" }

$testContracts = @(
  @{ id = '1004030657'; scenario = 'FRC LAND — trucking qty'; incoterm = 'FRC' },
  @{ id = '1004022767'; scenario = 'FRC LAND Open'; incoterm = 'FRC' },
  @{ id = '1004026972'; scenario = 'LCO LAND — GR STO status'; incoterm = 'LCO' },
  @{ id = '1364001990'; scenario = 'LCO GR PO≠GR STO'; incoterm = 'LCO' },
  @{ id = '1014003019'; scenario = 'FOB MIX STO V — vessel qty'; incoterm = 'FOB' },
  @{ id = '1004027309'; scenario = 'FOB SEA — vessel qty'; incoterm = 'FOB' },
  @{ id = '1014003049'; scenario = 'CIF MIX STO T — trucking qty'; incoterm = 'CIF' },
  @{ id = '1014002816'; scenario = 'CIF SEA STO T — trucking in SAP'; incoterm = 'CIF' }
)

$results = @()

function Get-ContractsRow($contractId) {
  $r = Invoke-RestMethod -Uri "$base/api/contracts?search=$contractId&limit=5" -Headers $headers
  $list = if ($r.data.contracts) { $r.data.contracts } else { $r.data }
  return $list | Where-Object { $_.contract_id -eq $contractId } | Select-Object -First 1
}

function Get-TruckingRow($contractId) {
  $r = Invoke-RestMethod -Uri "$base/api/trucking?search=$contractId&limit=10" -Headers $headers
  $list = if ($r.data.operations) { $r.data.operations } else { $r.data }
  return $list | Where-Object { $_.contract_number -eq $contractId -or $_.contract_id -eq $contractId } | Select-Object -First 1
}

function Get-ShipmentRow($contractId) {
  $r = Invoke-RestMethod -Uri "$base/api/shipments?search=$contractId&limit=10" -Headers $headers
  $list = if ($r.data.shipments) { $r.data.shipments } else { $r.data }
  return $list | Where-Object { $_.contract_number -eq $contractId -or $_.contract_id -eq $contractId } | Select-Object -First 1
}

foreach ($tc in $testContracts) {
  $cid = $tc.id
  Write-Host "Testing $cid ($($tc.scenario))..."

  try {
    $c = Get-ContractsRow $cid
    if ($c) {
      $results += [PSCustomObject]@{
        Contract = $cid
        Scenario = $tc.scenario
        Surface = 'Contracts list'
        Field = 'import_status'
        Value = $c.import_status
        QtyDelivery = $c.quantity_delivery
        Outstanding = $c.outstanding_quantity
        Incoterm = $c.incoterm
        Transport = $c.transport_mode
      }
    } else {
      $results += [PSCustomObject]@{ Contract = $cid; Scenario = $tc.scenario; Surface = 'Contracts list'; Field = 'ROW'; Value = 'NOT FOUND' }
    }
  } catch { $results += [PSCustomObject]@{ Contract = $cid; Surface = 'Contracts list'; Field = 'ERROR'; Value = $_.Exception.Message } }

  if ($tc.incoterm -in @('FRC','LCO')) {
    try {
      $t = Get-TruckingRow $cid
      if ($t) {
        $results += [PSCustomObject]@{
          Contract = $cid; Scenario = $tc.scenario; Surface = 'Trucking list'
          Field = 'contract_import_status'; Value = $t.contract_import_status
          QtyDelivery = $t.quantity_delivered; Outstanding = $t.outstanding_quantity
        }
      }
    } catch { }
  }

  if ($tc.incoterm -in @('CIF','FOB')) {
    try {
      $s = Get-ShipmentRow $cid
      if ($s) {
        $results += [PSCustomObject]@{
          Contract = $cid; Scenario = $tc.scenario; Surface = 'Shipments list'
          Field = 'contract_import_status'; Value = $s.contract_import_status
          Outstanding = $s.outstanding_quantity
        }
      }
    } catch { }
  }
}

$outPath = Join-Path $PSScriptRoot 'sap-uat-api-results.json'
$results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $outPath
Write-Host "`nResults saved to $outPath"
$results | Format-Table -AutoSize
