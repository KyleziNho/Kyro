class DecryptedText {
  constructor(element, options = {}) {
    this.element = element;
    this.text = options.text || element.textContent;
    this.speed = options.speed || 50;
    this.maxIterations = options.maxIterations || 10;
    this.sequential = options.sequential || false;
    this.revealDirection = options.revealDirection || 'start';
    this.useOriginalCharsOnly = options.useOriginalCharsOnly || false;
    this.characters = options.characters || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+';
    this.animateOn = options.animateOn || 'hover';

    this.displayText = this.text;
    this.isHovering = false;
    this.isScrambling = false;
    this.revealedIndices = new Set();
    this.interval = null;
    this.currentIteration = 0;
    this.hasAnimated = false;

    this.init();
  }

  init() {
    // Set initial content
    this.element.textContent = this.text;
    this.element.style.whiteSpace = 'pre-wrap';
    this.element.style.display = 'inline-block';

    // Setup event listeners
    if (this.animateOn === 'hover' || this.animateOn === 'both') {
      this.element.addEventListener('mouseenter', () => this.startAnimation());
      this.element.addEventListener('mouseleave', () => this.stopAnimation());
    }

    if (this.animateOn === 'view' || this.animateOn === 'both') {
      this.setupIntersectionObserver();
    }
  }

  setupIntersectionObserver() {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !this.hasAnimated) {
            this.startAnimation();
            this.hasAnimated = true;
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(this.element);
  }

  getAvailableChars() {
    if (this.useOriginalCharsOnly) {
      return Array.from(new Set(this.text.split(''))).filter(char => char !== ' ');
    }
    return this.characters.split('');
  }

  getNextIndex(revealedSet) {
    const textLength = this.text.length;
    switch (this.revealDirection) {
      case 'start':
        return revealedSet.size;
      case 'end':
        return textLength - 1 - revealedSet.size;
      case 'center': {
        const middle = Math.floor(textLength / 2);
        const offset = Math.floor(revealedSet.size / 2);
        const nextIndex = revealedSet.size % 2 === 0 ? middle + offset : middle - offset - 1;

        if (nextIndex >= 0 && nextIndex < textLength && !revealedSet.has(nextIndex)) {
          return nextIndex;
        }

        for (let i = 0; i < textLength; i++) {
          if (!revealedSet.has(i)) return i;
        }
        return 0;
      }
      default:
        return revealedSet.size;
    }
  }

  shuffleText(currentRevealed) {
    const availableChars = this.getAvailableChars();

    if (this.useOriginalCharsOnly) {
      const positions = this.text.split('').map((char, i) => ({
        char,
        isSpace: char === ' ',
        index: i,
        isRevealed: currentRevealed.has(i)
      }));

      const nonSpaceChars = positions.filter(p => !p.isSpace && !p.isRevealed).map(p => p.char);

      for (let i = nonSpaceChars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nonSpaceChars[i], nonSpaceChars[j]] = [nonSpaceChars[j], nonSpaceChars[i]];
      }

      let charIndex = 0;
      return positions
        .map(p => {
          if (p.isSpace) return ' ';
          if (p.isRevealed) return this.text[p.index];
          return nonSpaceChars[charIndex++];
        })
        .join('');
    } else {
      return this.text
        .split('')
        .map((char, i) => {
          if (char === ' ') return ' ';
          if (currentRevealed.has(i)) return this.text[i];
          return availableChars[Math.floor(Math.random() * availableChars.length)];
        })
        .join('');
    }
  }

  updateDisplay() {
    this.element.textContent = this.displayText;
  }

  startAnimation() {
    this.isHovering = true;
    this.isScrambling = true;
    this.currentIteration = 0;

    if (this.interval) {
      clearInterval(this.interval);
    }

    this.interval = setInterval(() => {
      if (this.sequential) {
        if (this.revealedIndices.size < this.text.length) {
          const nextIndex = this.getNextIndex(this.revealedIndices);
          this.revealedIndices.add(nextIndex);
          this.displayText = this.shuffleText(this.revealedIndices);
          this.updateDisplay();
        } else {
          this.stopAnimation();
        }
      } else {
        this.displayText = this.shuffleText(this.revealedIndices);
        this.updateDisplay();
        this.currentIteration++;

        if (this.currentIteration >= this.maxIterations) {
          this.displayText = this.text;
          this.updateDisplay();
          this.stopAnimation();
        }
      }
    }, this.speed);
  }

  stopAnimation() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.isHovering = false;
    this.isScrambling = false;
    this.revealedIndices.clear();
    this.displayText = this.text;
    this.updateDisplay();
  }

  destroy() {
    this.stopAnimation();
    this.element.removeEventListener('mouseenter', () => this.startAnimation());
    this.element.removeEventListener('mouseleave', () => this.stopAnimation());
  }
}
