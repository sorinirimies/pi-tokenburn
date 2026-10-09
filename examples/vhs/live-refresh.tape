# VHS tape: live-refresh
# The footer updates after every assistant message, not just when a turn ends. A tiny
# local mock model (mock-llm.ts) gives pi a real reply with token usage: the counter and
# cost move on their own as pi writes the turn to its session log.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/live-refresh.gif

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
Type "(bun examples/vhs/mock-llm.ts >/dev/null 2>&1 &) ; export PI_DEMO_LIVE=1 ; sleep 1 ; clear"
Enter
Type "bash examples/vhs/pi-demo.sh"
Enter
Wait+Screen@30s /\[today\]/
Show

# Today so far
Sleep 3s
Type "Explain what pi-tokenburn does in one sentence"
Sleep 800ms
Enter
# The reply streams in, then the footer ticks up by itself
Sleep 7s
# Turn the per-message refresh off and the line only updates when a turn ends
Type "/tokenburn live"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s

# (hidden) quit pi, then stop the mock model
Hide
Ctrl+D
Sleep 1s
Type "pkill -f mock-llm"
Enter
Sleep 500ms
