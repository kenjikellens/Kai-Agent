function showAlert() {
    alert("Hello from app.js! This is a simple alert.");
}

// Find the button and attach the event listener
const button = document.getElementById('myButton');
if (button) {
    button.addEventListener('click', showAlert);
}
