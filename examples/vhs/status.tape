# VHS tape: status
# /tokenburn day|week|month|year|all switches what the bottom status line shows (it prints
# no chart). /tokenburn cycle rotates today > week > month > year > total.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/status.gif

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
# Pick a period by name
Type "/tokenburn week"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.2s
Type "/tokenburn month"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.2s
Type "/tokenburn year"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.2s
Type "/tokenburn all"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.2s
Type "/tokenburn day"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.2s
# Or rotate through them
Type "/tokenburn cycle"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 1.8s
Type "/tokenburn cycle"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 1.8s
Type "/tokenburn cycle"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 1.8s
Type "/tokenburn cycle"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 1.8s
Type "/tokenburn cycle"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 1.8s
