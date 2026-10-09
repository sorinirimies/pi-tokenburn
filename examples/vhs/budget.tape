# VHS tape: budget
# A token or dollar budget per day, week or month. Past it the footer turns red
# ("OVER BUDGET") and the chart draws a budget line with the over-budget columns in red.
#
# Runs a real pi with only the pi-tokenburn extension loaded, on the throw-away
# data from fixture.sh (HOME and the pi agent dir redirected into /tmp), so it
# never reads your real sessions, settings or credentials.

Output examples/vhs/generated/budget.gif

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
# 150k tokens a day: today is past it
Type "/tokenburn budget day 150000"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2.8s
# The chart shows the budget line and which days broke it
Type "/tokenburn chart day"
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
# A dollar budget works too
Type "/tokenburn budget week $2.5"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 2s
Type "/tokenburn week"
Sleep 700ms
Enter
Sleep 300ms
Enter
Sleep 3s
