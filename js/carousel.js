document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.carousel').forEach(function (carousel) {
    var track = carousel.querySelector('.carousel__track');
    var slides = Array.prototype.slice.call(track.children);
    var prevBtn = carousel.querySelector('.carousel__btn--prev');
    var nextBtn = carousel.querySelector('.carousel__btn--next');
    var dotsWrap = carousel.querySelector('.carousel__dots');
    var first = 0; // index of the first slide in the visible window
    var dots = [];

    function perView() {
      var v = parseInt(getComputedStyle(carousel).getPropertyValue('--per'), 10);
      return isNaN(v) || v < 1 ? 1 : v;
    }

    function maxFirst() {
      return Math.max(0, slides.length - perView());
    }

    function slideStep() {
      return slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth;
    }

    function buildDots() {
      dotsWrap.innerHTML = '';
      dots = [];
      var positions = maxFirst() + 1;
      dotsWrap.style.display = positions > 1 ? '' : 'none';
      for (var i = 0; i < positions; i++) {
        (function (i) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'carousel__dot';
          dot.setAttribute('role', 'tab');
          dot.setAttribute('aria-label', 'Go to position ' + (i + 1) + ' of ' + positions);
          dot.addEventListener('click', function () { goTo(i); });
          dotsWrap.appendChild(dot);
          dots.push(dot);
        })(i);
      }
    }

    function setActive(index) {
      first = Math.max(0, Math.min(maxFirst(), index));
      var last = first + perView() - 1;
      slides.forEach(function (slide, i) {
        slide.classList.toggle('is-out', i < first || i > last);
      });
      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === first);
        dot.setAttribute('aria-selected', i === first ? 'true' : 'false');
      });
      prevBtn.disabled = first === 0;
      nextBtn.disabled = first === maxFirst();
    }

    function goTo(index) {
      index = Math.max(0, Math.min(maxFirst(), index));
      setActive(index);
      track.scrollTo({
        left: slides[index].offsetLeft - slides[0].offsetLeft,
        behavior: 'smooth'
      });
    }

    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var index = Math.round(track.scrollLeft / slideStep());
        if (index !== first) setActive(index);
      });
    });

    window.addEventListener('resize', function () {
      buildDots();
      setActive(first);
    });

    carousel.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(first - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(first + 1); }
    });

    prevBtn.addEventListener('click', function () { goTo(first - 1); });
    nextBtn.addEventListener('click', function () { goTo(first + 1); });

    slides.forEach(function (slide, i) {
      slide.addEventListener('click', function () {
        if (i < first) goTo(i);
        else if (i > first + perView() - 1) goTo(i - perView() + 1);
      });
    });

    buildDots();
    setActive(0);
  });
});
