# VHS tape: enable-disable
# /tokenburn disable switches everything off: the footer is cleared and nothing runs in
# the background. Charts still work on demand. /tokenburn enable brings it all back.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/enable-disable.gif

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
Type "/tokenburn disable"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
# Disabled, but a chart is still one command away
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
Type "/tokenburn enable"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
