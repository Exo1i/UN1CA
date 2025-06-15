import cliProgress from "cli-progress";

export class UniversalProgressBar {
  private bar: cliProgress.SingleBar | null = null;
  private isTTY: boolean;
  private total: number;
  private current: number = 0;
  private lastLog: number = 0;
  private startTime: number = Date.now();

  constructor(total: number) {
    this.total = total;
    this.isTTY = process.stdout.isTTY;
    if (this.isTTY) {
      this.bar = new cliProgress.SingleBar({
        format: "{bar} {percentage}% | {value}/{total} | {file}",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
      });
      this.bar.start(this.total, 0);
    } else {
      console.log("Progress logging enabled (CI mode)");
    }
  }

  update(value: number, payload?: { file?: string }) {
    this.current = value;
    if (this.bar) {
      this.bar.update(value, payload);
    } else {
      const now = Date.now();
      if (now - this.lastLog > 5000 || value === this.total) {
        const percent = ((value / this.total) * 100).toFixed(1);
        const file = payload?.file ? ` | File: ${payload.file}` : "";
        console.log(
          `Progress: ${percent}% (${value}/${this.total})${file}`
        );
        this.lastLog = now;
      }
    }
  }

  stop() {
    if (this.bar) this.bar.stop();
    else console.log("Download complete.");
  }
}

export function createProgressBar(opts: { total: number }) {
  return new UniversalProgressBar(opts.total);
}
