# Creates the GitHub repository, then pushes this branch to it.
# Requires either an existing `origin` remote, or the GitHub CLI signed in.
#
#   npm run publish
#
$ErrorActionPreference = "Stop"

function Resolve-Git {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $fallback = "C:\Program Files\Git\cmd\git.exe"
  if (Test-Path $fallback) { return $fallback }

  throw "git is not installed or not on PATH."
}

$git = Resolve-Git
$repoRoot = Split-Path -Parent $PSScriptRoot
$repoName = Split-Path -Leaf $repoRoot
$description = "Municipal incident intelligence: citizen reports, asynchronous AI triage and an authority operations dashboard."

Push-Location $repoRoot
try {
  $branch = (& $git rev-parse --abbrev-ref HEAD).Trim()
  $dirty = & $git status --porcelain
  if ($dirty) {
    Write-Host "Uncommitted changes detected. Commit or stash them before publishing:" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "  $_" }
    exit 1
  }

  $remotes = @(& $git remote)
  if ($remotes -contains "origin") {
    Write-Host "Pushing to existing origin: $(& $git remote get-url origin)"
    & $git push -u origin $branch
    exit $LASTEXITCODE
  }

  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  $ghExe = if ($ghCommand) { $ghCommand.Source } else { $null }
  if (-not $ghExe) {
    $candidates = @(
      (Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "GitHub CLI\gh.exe"),
      (Join-Path $env:LOCALAPPDATA "GitHubCLI\gh.exe")
    )
    $ghExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  }

  if (-not $ghExe) {
    Write-Host ""
    Write-Host "No Git remote yet, and the GitHub CLI is not installed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Option A - install the CLI once:"
    Write-Host "  winget install --id GitHub.cli"
    Write-Host "  gh auth login"
    Write-Host "  npm run publish"
    Write-Host ""
    Write-Host "Option B - create an empty repo at https://github.com/new, then run:"
    Write-Host "  git remote add origin https://github.com/<your-username>/$repoName.git"
    Write-Host "  git push -u origin $branch"
    exit 1
  }

  & $ghExe auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "No GitHub session yet. Opening the GitHub sign-in flow..." -ForegroundColor Yellow
    Write-Host "Copy the one-time code shown below, press Enter, and approve in the browser."
    & $ghExe auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Sign-in was not completed. Run 'gh auth login' and try again." -ForegroundColor Yellow
      exit 1
    }
  }

  $login = (& $ghExe api user --jq .login).Trim()
  $userIds = (& $ghExe api user --jq .id).Trim()
  $currentEmail = (& $git config user.email).Trim()

  if (-not $currentEmail -or $currentEmail -eq "codew@users.noreply.github.com") {
    & $git config user.name $login
    & $git config user.email "$userIds+$login@users.noreply.github.com"
    Write-Host "Commit identity for future commits: $login <$userIds+$login@users.noreply.github.com>"
    Write-Host "Older commits keep the identity they were created with; they are attributed to GitHub user '$login' only if that matches."
  }

  Write-Host "Creating github.com/$login/$repoName and pushing '$branch'..."
  & $ghExe repo create $repoName --public --source=. --remote=origin --push --description $description
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  & $ghExe repo edit --add-topic civictech --add-topic hackathon --add-topic react --add-topic express --add-topic ai 2>$null

  Write-Host ""
  Write-Host "Published: https://github.com/$login/$repoName" -ForegroundColor Green
  Write-Host "Deploy from the blueprint:"
  Write-Host "  https://dashboard.render.com/blueprint/new?repo=https://github.com/$login/$repoName"
}
finally {
  Pop-Location
}
