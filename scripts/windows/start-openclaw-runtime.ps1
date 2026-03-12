$RepoPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Command = @"
cd '$RepoPath'
export RUNTIME_ROOT='${env:USERPROFILE}/oc-runtime'
nohup npm run runtime:browser-api >/tmp/oc-browser-api.log 2>&1 &
nohup npm run runtime:server >/tmp/oc-runtime.log 2>&1 &
"@

wsl -d Ubuntu -u zach -- bash -lc $Command
