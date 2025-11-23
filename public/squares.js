class Squares {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.direction = options.direction || 'diagonal';
    this.speed = Math.max(options.speed || 0.5, 0.1);
    this.borderColor = options.borderColor || 'rgba(255, 255, 255, 0.1)';
    this.squareSize = options.squareSize || 40;
    this.hoverFillColor = options.hoverFillColor || 'rgba(78, 205, 196, 0.1)';

    this.gridOffset = { x: 0, y: 0 };
    this.hoveredSquare = null;
    this.animationFrame = null;

    this.init();
  }

  init() {
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());

    this.animate();
  }

  resizeCanvas() {
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
  }

  drawGrid() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const startX = Math.floor(this.gridOffset.x / this.squareSize) * this.squareSize;
    const startY = Math.floor(this.gridOffset.y / this.squareSize) * this.squareSize;

    for (let x = startX; x < this.canvas.width + this.squareSize; x += this.squareSize) {
      for (let y = startY; y < this.canvas.height + this.squareSize; y += this.squareSize) {
        const squareX = x - (this.gridOffset.x % this.squareSize);
        const squareY = y - (this.gridOffset.y % this.squareSize);

        if (
          this.hoveredSquare &&
          Math.floor((x - startX) / this.squareSize) === this.hoveredSquare.x &&
          Math.floor((y - startY) / this.squareSize) === this.hoveredSquare.y
        ) {
          this.ctx.fillStyle = this.hoverFillColor;
          this.ctx.fillRect(squareX, squareY, this.squareSize, this.squareSize);
        }

        this.ctx.strokeStyle = this.borderColor;
        this.ctx.strokeRect(squareX, squareY, this.squareSize, this.squareSize);
      }
    }

    // Add vignette gradient
    const gradient = this.ctx.createRadialGradient(
      this.canvas.width / 2,
      this.canvas.height / 2,
      0,
      this.canvas.width / 2,
      this.canvas.height / 2,
      Math.sqrt(this.canvas.width ** 2 + this.canvas.height ** 2) / 2
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  updateAnimation() {
    switch (this.direction) {
      case 'right':
        this.gridOffset.x = (this.gridOffset.x - this.speed + this.squareSize) % this.squareSize;
        break;
      case 'left':
        this.gridOffset.x = (this.gridOffset.x + this.speed + this.squareSize) % this.squareSize;
        break;
      case 'up':
        this.gridOffset.y = (this.gridOffset.y + this.speed + this.squareSize) % this.squareSize;
        break;
      case 'down':
        this.gridOffset.y = (this.gridOffset.y - this.speed + this.squareSize) % this.squareSize;
        break;
      case 'diagonal':
        this.gridOffset.x = (this.gridOffset.x - this.speed + this.squareSize) % this.squareSize;
        this.gridOffset.y = (this.gridOffset.y - this.speed + this.squareSize) % this.squareSize;
        break;
      default:
        break;
    }
  }

  animate() {
    this.updateAnimation();
    this.drawGrid();
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  handleMouseMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const startX = Math.floor(this.gridOffset.x / this.squareSize) * this.squareSize;
    const startY = Math.floor(this.gridOffset.y / this.squareSize) * this.squareSize;

    const hoveredSquareX = Math.floor((mouseX + this.gridOffset.x - startX) / this.squareSize);
    const hoveredSquareY = Math.floor((mouseY + this.gridOffset.y - startY) / this.squareSize);

    if (
      !this.hoveredSquare ||
      this.hoveredSquare.x !== hoveredSquareX ||
      this.hoveredSquare.y !== hoveredSquareY
    ) {
      this.hoveredSquare = { x: hoveredSquareX, y: hoveredSquareY };
    }
  }

  handleMouseLeave() {
    this.hoveredSquare = null;
  }

  destroy() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    window.removeEventListener('resize', () => this.resizeCanvas());
    this.canvas.removeEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.removeEventListener('mouseleave', () => this.handleMouseLeave());
  }
}
