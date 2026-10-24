# VHS tape: statusline
# What the footer shows: the status period (hour, today, week, ...), the burn rate, the cache hit
# ratio and the estimated cache savings. Rate, hit and saved are each toggleable.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/statusline.gif

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
# Last 60 minutes
Type "/tokenburn hour"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
# A longer period averages the rate over it
Type "/tokenburn week"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
# Switch the extras off one by one
Type "/tokenburn rate"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.2s
Type "/tokenburn hit"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.2s
Type "/tokenburn saved"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.5s
# ...and back on
Type "/tokenburn rate"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 1.8s
Type "/tokenburn hit"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 1.8s
Type "/tokenburn saved"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.5s
Type "/tokenburn day"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.5s
