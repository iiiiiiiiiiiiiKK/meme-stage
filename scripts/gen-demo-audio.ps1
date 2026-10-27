# Generates the official demo voice lines with the built-in Windows voice.
# Reads UTF-8 lines from scripts/demo-lines.json (avoids PS 5.1 encoding issues).
# Output: public/demo/*.wav (16 kHz mono PCM, plays in every browser).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "public\demo"
$linesPath = Join-Path $PSScriptRoot "demo-lines.json"
New-Item -ItemType Directory -Force $out | Out-Null

$json = [System.IO.File]::ReadAllText($linesPath, [System.Text.Encoding]::UTF8)
$lines = $json | ConvertFrom-Json

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

foreach ($line in $lines) {
  $path = Join-Path $out $line.file
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synth.SelectVoice($line.voice)
    $synth.Rate = [int]$line.rate
    $synth.Volume = 100
    $synth.SetOutputToWaveFile($path, $format)
    $synth.Speak($line.text)
  }
  finally {
    $synth.Dispose()
  }
  $size = (Get-Item $path).Length
  Write-Host ("{0,-22} {1,8:N0} bytes" -f $line.file, $size)
}

Write-Host "done -> $out"
