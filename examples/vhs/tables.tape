# VHS tape: tables
# Usage tables: per model, provider, project and session, for any period (hour, day,
# week, month, year, all). Each shows tokens, in/out, cache hit %, estimated cache savings,
# cost and share.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/tables.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 720
Set Padding 24
Set PlaybackSpeed 1.0
Set Theme "Catppuccin Mocha"

Hide
Type 'bash examples/vhs/fixture.sh >/dev/null && echo DONE-$((6*7))'
Enter
Wait+Screen@60s /DONE-42/
Type 'eval "$(examples/vhs/fixture.sh env)" && clear'
Enter
Type "bash examples/vhs/pi-demo.sh"
Enter
Wait+Screen@30s /\[today\]/
Show

Sleep 2s
# Which models cost what this week
Type "/tokenburn models week"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 5s
Type "/new"
Sleep 400ms
Enter
Sleep 300ms
Enter
Sleep 800ms
# Per provider
Type "/tokenburn providers month"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 4s
Type "/new"
Sleep 400ms
Enter
Sleep 300ms
Enter
Sleep 800ms
# Per project, whole history
Type "/tokenburn projects"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 5s
Type "/new"
Sleep 400ms
Enter
Sleep 300ms
Enter
Sleep 800ms
# The five biggest sessions this week
Type "/tokenburn sessions week 5"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 5s
