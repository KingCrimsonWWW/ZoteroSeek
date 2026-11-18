<#
.SYNOPSIS
  演示脚本：一条命令跑完「自检 → 检索评测（词面 vs 跨语言）」。
.DESCRIPTION
  pwsh -File scripts/demo.ps1
  不调用模型，几秒内出结果；生成侧指标用会话里的 zotero_eval 工具。
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '==== 1/4 环境自检 ====' -ForegroundColor Cyan
node evals/doctor.mjs

Write-Host "`n==== 2/4 同语言检索评测（纯词面 vs 混合）====" -ForegroundColor Cyan
foreach ($mode in @('lexical', 'hybrid')) {
  $out = node evals/run-eval.mjs --qa evals/qa-set.jsonl --mode $mode 2>&1
  $metrics = ($out | Select-String -Pattern '^\| (recall@5|MRR|hit_rate)').Line -join '  '
  Write-Host ("  qa-set  [{0,-7}] {1}" -f $mode, $metrics)
}

Write-Host "`n==== 3/4 跨语言检索评测（中文问英文文献）====" -ForegroundColor Cyan
foreach ($mode in @('lexical', 'hybrid')) {
  $out = node evals/run-eval.mjs --qa evals/qa-set-cross.jsonl --mode $mode 2>&1
  $metrics = ($out | Select-String -Pattern '^\| (recall@5|MRR|hit_rate)').Line -join '  '
  Write-Host ("  qa-set-cross  [{0,-7}] {1}" -f $mode, $metrics)
}

Write-Host "`n==== 4/4 生成侧（在会话里调用工具）====" -ForegroundColor Cyan
Write-Host '  zotero_eval(qa_path="E:\TheCode\ZoteroSeek\evals\qa-set.jsonl")'
Write-Host '  zotero_eval(qa_path="E:\TheCode\ZoteroSeek\evals\qa-set-cross.jsonl")'

Write-Host "`n最近两份检索报告：" -ForegroundColor Cyan
Get-ChildItem evals/reports -Filter '*-retrieval.md' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 2 |
  ForEach-Object { Write-Host "  $($_.FullName)" }
