document.addEventListener('DOMContentLoaded', () => {
    const trailerBtn = document.getElementById('trailerBtn');
    
    // Create modal element dynamically
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <h3>GTA VI - Vice City / Leonida Trailer</h3>
            <div class="modal-video-container">
                <p>🎬 Rockstar Games Officiële Trailer 1</p>
                <iframe width="100%" height="315" src="https://www.youtube.com/embed/QdBZY2fkU-0" title="GTA VI Trailer" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
            </div>
            <p class="modal-desc">Blijf op de hoogte van al het GTA VI nieuws en releases!</p>
        </div>
    `;
    document.body.appendChild(modal);

    const closeModal = modal.querySelector('.close-modal');

    trailerBtn.addEventListener('click', () => {
        modal.classList.add('active');
    });

    closeModal.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    // Smooth scroll for nav links if any
    console.log('GTA VI Ultimate Guide UI loaded successfully.');
});
