# VHS tape: filter-export
# Focus on one provider, model or project with /tokenburn filter (footer, report, charts, tables
# and exports all follow it), then write the numbers to a csv file.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/filter-export.gif

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
# Only this model: the footer label shows it
Type "/tokenburn filter model acme-large"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
Type "/tokenburn models week"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 4.5s
Type "/new"
Sleep 400ms
Enter
Sleep 300ms
Enter
Sleep 800ms
# Export what is left to a file
Type "/tokenburn export csv week demo-usage.csv"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
# Back to everything
Type "/tokenburn filter all"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
