# VHS tape: charts
# /tokenburn chart day|week|month|year|all: a summary table plus a column chart with a
# y-axis, the current period marked in green, and a peak/average footer.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/charts.gif

Set Shell "bash"
Set FontSize 14
Set Width 1600
Set Height 900
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

Sleep 1.5s
Type "/tokenburn chart day"
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
Type "/tokenburn chart week"
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
Type "/tokenburn chart month"
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
Type "/tokenburn chart year"
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
Type "/tokenburn chart all"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 4.5s
