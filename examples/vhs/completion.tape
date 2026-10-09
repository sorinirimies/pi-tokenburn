# VHS tape: completion
# Tab-completion for every command and argument, using pi's own autocomplete menu.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/completion.gif

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

Sleep 1.5s
Type "/tokenburn "
Sleep 2.5s
Down
Sleep 500ms
Down
Sleep 500ms
Down
Sleep 800ms
# Narrow it down, accept "chart ", then retype the space: the sub-menu of views opens
Type "ch"
Sleep 1.2s
Enter
Sleep 800ms
Backspace
Sleep 300ms
Type " "
Sleep 2s
Down
Sleep 500ms
Down
Sleep 900ms
Enter
Sleep 500ms
Enter
Sleep 4.5s
