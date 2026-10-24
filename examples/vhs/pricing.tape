# VHS tape: pricing
# Where costs come from: pi logs them per turn; /tokenburn pricing shows how many turns have a logged
# cost. A price table ($/M tokens) fills in missing costs, or overrides logged ones.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/pricing.gif

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
# Cost sources and the models seen
Type "/tokenburn pricing"
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
# Set a price for a model
Type "/tokenburn price acme-large 3 15 0.3 3.75"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
# Let the table win over the logged cost
Type "/tokenburn pricing mode override"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 5s
