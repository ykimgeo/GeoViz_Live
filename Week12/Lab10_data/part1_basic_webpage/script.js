const button = document.getElementById('toggle-button');
const details = document.getElementById('extra-details');
const title = document.getElementById('page-title');
const button2 = document.getElementById('toggle-button-2')

button.addEventListener('click', () => {
  details.classList.toggle('hidden');

  if (details.classList.contains('hidden')) {
    button.textContent = 'Show / hide extra details';
  } else {
    button.textContent = 'Hide extra details';
  }
});

button2.addEventListener('click', () => {
  details.classList.toggle('hidden');

  if (details.classList.contains('hidden')) {
    button2.textContent = 'Show / hide extra details';
  } else {
    button2.textContent = 'Hide extra details';
  }
});

// Example: change the title when the page loads.
title.textContent = 'Lab 10: HTML + CSS + JavaScript Basics';
title.classList.add('highlight-title');
