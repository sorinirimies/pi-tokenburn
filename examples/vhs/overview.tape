# VHS tape: overview
# The whole plugin in one go: the live token counter in pi's footer, the report with a
# daily chart, switching the footer to month and year, a weekly chart, and cycling.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/overview.gif

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

# The footer already shows today's tokens and cost
Sleep 2.5s
# Report + daily chart
Type "/tokenburn"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 5s
# Switch what the bottom line shows
Type "/tokenburn month"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.5s
Type "/tokenburn year"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.5s
# A weekly chart (the current week is green)
Type "/tokenburn chart week"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 5s
# Rotate the footer period with one command
Type "/tokenburn cycle"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2s
Type "/tokenburn cycle"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2s
