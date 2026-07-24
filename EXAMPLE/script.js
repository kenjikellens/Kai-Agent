document.addEventListener('DOMContentLoaded', () => {
    const boardElement = document.getElementById('board');
    const statusElement = document.getElementById('status');
    const resetButton = document.getElementById('reset-button');

    // Initialize the game state
    let board = ['', '', '', '', '', '', '', '', ''];
    let currentPlayer = 'X'; // Player 1 starts as X
    let isGameActive = true;

    // Function to render the board
    function renderBoard() {
        boardElement.innerHTML = '';
        board.forEach((cellValue, index) => {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.textContent = cellValue;
            cell.dataset.index = index;
            cell.addEventListener('click', handleCellClick);
            boardElement.appendChild(cell);
        });
    }

    // Function to handle a cell click
    function handleCellClick(event) {
        const clickedCell = event.target;
        const clickedIndex = parseInt(clickedCell.dataset.index);

        if (board[clickedIndex] !== '' || !isGameActive) {
            return;
        }

        // Update the board state and UI
        board[clickedIndex] = currentPlayer;
        clickedCell.textContent = currentPlayer;

        // Check for game end conditions
        if (checkResult()) {
            statusElement.textContent = `${currentPlayer} has won!`;
            isGameActive = false;
            return;
        }

        // If no winner and board is full, it's a draw
        if (board.every(cell => cell !== '')) {
            statusElement.textContent = "Game ended in a Draw!";
            isGameActive = false;
            return;
        }

        // Switch player
        switchPlayer();
    }

    // Function to switch the current player
    function switchPlayer() {
        currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
        statusElement.textContent = `Player ${currentPlayer}'s turn`;
    }

    // Function to check for a winner
    function checkResult() {
        const lines = [
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8],
            [0, 3, 6],
            [1, 4, 7],
            [2, 5, 8],
            [0, 4, 8],
            [2, 4, 6]
        ];

        for (let i = 0; i < lines.length; i++) {
            const [a, b, c] = lines[i];
            if (board[a] && board[a] === board[b] && board[a] === board[c]) {
                return true;
            }
        }
        return false;
    }

    // Function to reset the game
    function resetGame() {
        board = ['', '', '', '', '', '', '', '', ''];
        currentPlayer = 'X';
        isGameActive = true;
        statusElement.textContent = "Player X's turn";
        renderBoard(); // Re-render the empty board
    }

    // Event listener for reset button
    resetButton.addEventListener('click', resetGame);

    // Initial render
    renderBoard();
});