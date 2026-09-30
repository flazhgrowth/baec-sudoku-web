# Sudoku App
The app will be a sudoku app. The Sudoku can be played by 1 person or 2 person. The one person play is the classic type play, while 2 players play, is basically a versus play, but under the same board and session. So it will be a turn based play, that the score is affected by how fast you fill in any box correctly, with the limit of 3 fault during the whole session

## Two Player Rules
1. Two Player Game will be a turn based game.
2. Every turn should be limit by 11s limit.
3. The faster a user fill in a box correctly, the higher the point the user get.
4. The max point user can get is 10 point, while the lowest user can get during a turn is 1 point. More than 10s will end the turn and move the turn to the other player
5. The whole session limit of faults is only 3 tries. Having 3 faults, will result in skipping 2 turns of that player. Once done, the limit will reset back to 0

## UX Rules
1. When selecting a box, it will highlight the row and the column of that selected box
2. When selecting a box with number, it will highlight the row and column of the selected box, and also highlight the other number of that selected box also
3. At the bottom of the box, there will be a clickable 1 - 9 to fill in the box. So filling the box should be solely from the this input only.
4. If a numbers already filled 9 times in the box, it won't show in the input row.
5. Filling a box should directly shows if the input is correct or not