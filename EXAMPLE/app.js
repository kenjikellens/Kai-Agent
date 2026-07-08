function validateForm() {
    var username = document.getElementById("username").value;
    var password = document.getElementById("password").value;
    var errorMsg = document.getElementById("error-msg");

    // Controleer of velden leeg zijn
    if (username === "" || password === "") {
        errorMsg.innerText = "Vul a.u.b. een gebruikersnaam en wachtwoord in.";
        errorMsg.style.display = "block";
        return false;
    }

    // Simpele validatie (voorbeeld: admin / admin)
    if (username !== "admin" || password !== "admin") {
        errorMsg.innerText = "Verkeerde gebruikersnaam of wachtwoord.";
        errorMsg.style.display = "block";
        return false;
    }

    // Als validatie slaagt
    errorMsg.style.display = "none";
    alert("Succesvol ingelogd!");
    return true;
}