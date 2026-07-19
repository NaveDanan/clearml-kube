import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnDestroy,
  ChangeDetectorRef, AfterViewInit, ElementRef, viewChild, input, output } from '@angular/core';
import {Subscription} from 'rxjs';
import {CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport} from '@angular/cdk/scrolling';
import {last, findLastIndex} from 'lodash-es';
import Convert from 'ansi-to-html';
import {Log} from '../../actions/common-experiment-output.actions';

import hasAnsi from 'has-ansi';
import {DatePipe} from '@angular/common';
import {SaferPipe} from '@common/shared/pipes/safe.pipe';
import {MatProgressSpinner} from '@angular/material/progress-spinner';
import {MatIcon} from '@angular/material/icon';
import {MatButton} from '@angular/material/button';
import {buildTerminalLogRows} from './terminal-log.utils';

interface LogRow {
  timestamp?: number | string;
  entry: string;
  separator?: boolean;
  hasAnsi?: boolean;
  rewriteKey?: string;
}

@Component({
    selector: 'sm-experiment-log-info',
    templateUrl: './experiment-log-info.component.html',
    styleUrls: ['./experiment-log-info.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CdkVirtualScrollViewport,
        CdkVirtualForOf,
        CdkFixedSizeVirtualScroll,
        DatePipe,
        SaferPipe,
        MatProgressSpinner,
        MatIcon,
        MatButton
    ]
})
export class ExperimentLogInfoComponent implements OnDestroy, AfterViewInit {
  public orgLogs: Log[];
  public lines = [] as LogRow[];
  private initial = true;
  public convert = new Convert() as Convert;
  private hasFilter = false;
  private regex: RegExp;
  private scrollSubscription: Subscription;
  private indexSubscription: Subscription;
  private shouldFocusLog = false;
  private scrolling = false;
  private prevLocation = 0;
  public canRefresh = true;
  private prevLine: LogRow;
  private fetchPrev: boolean;
  private prevLineOffset: number | null = null;

  private logContainer = viewChild(CdkVirtualScrollViewport);
  fetching = input(false);
  beginningOfLog = input<boolean>();
  private readonly hasAnsi = hasAnsi;
  private observer: IntersectionObserver;
  private logInView: boolean;
  public atEnd = true;
  private locationBeforeFilter: number;

  @Input() set filterString(filter: string) {
    if (this.logInView) {
      this.shouldFocusLog = false;
      setTimeout(() => this.shouldFocusLog = true, 1000);
    }
    if(!this.hasFilter && filter) {
      this.locationBeforeFilter = findLastIndex(this.lines, this.prevLine) + this.prevLineOffset;
    } else if (this.locationBeforeFilter !== null) {
      window.setTimeout(() => {
        this.logContainer()?.scrollToIndex(this.locationBeforeFilter);
        this.locationBeforeFilter = null;
      })
    }
    this.hasFilter = !!filter;
    if (this.hasFilter) {
      this.regex = ExperimentLogInfoComponent.getRegexFromString(filter);
    }

    if (this.orgLogs) {
      this.calcLines();
    }
  }

  @Input() set logs(log: Log[]) {
    if (log === null) {
      return;
    }
    const autoRefresh = this.fetchPrev === null;
    this.orgLogs = log;
    this.calcLines();
    let prevLocation;
    if (autoRefresh && this.atEnd) {
      prevLocation = this.lines.length;
    } else {
      prevLocation = findLastIndex(this.lines, this.prevLine) + this.prevLineOffset;
    }
    this.fetchPrev = null;
    if (!this.initial && prevLocation) {
      this.scrolling = true;
      window.setTimeout(() => {
        this.logContainer()?.scrollToIndex(prevLocation);
        window.setTimeout(() => this.scrolling = false, 50);
      });
    } else {
      const elm = this.logContainer()?.elementRef.nativeElement;
      if (!elm || log?.length && (elm.scrollTop + elm.offsetHeight > elm.scrollHeight - 100 || this.initial)) {
        this.initial = false;
        this.scrolling = true;
        window.setTimeout(() => {
          this.logContainer()?.scrollToIndex(this.lines.length);
          this.scrolledToBottom.emit();
          this.canRefresh = true;
          window.setTimeout(() => this.scrolling = false, 80);
        }, 10);
      }
    }
  }

  scrolledToBottom = output();

  fetchMore = output<{
        direction: string;
        from?: number;
    }>();

  constructor(private cdr: ChangeDetectorRef, private element: ElementRef) {}

  ngAfterViewInit() {
    this.scrollSubscription = this.logContainer()?.elementScrolled().subscribe((event: Event) => {
      if (this.shouldFocusLog) {
        setTimeout(() => (event.target as HTMLElement).focus(), 50);
      }
    });

    window.setTimeout(() => {
      this.indexSubscription = this.logContainer()?.scrolledIndexChange.subscribe((location: number) => {
        const itemsInView = Math.ceil(this.logContainer()?.getViewportSize() / 25);
        this.atEnd = location >= this.lines.length - itemsInView - 1;
        if (!this.fetching() && !this.scrolling) {
          if (location < 10 && location < this.prevLocation && !this.beginningOfLog()) {
            this.fetchPrev = true;
            this.fetchMore.emit({direction: 'prev', from: this.orgLogs?.[0]?.timestamp});
          } else if (this.atEnd && location > this.prevLocation) {
            this.fetchPrev = false;
            this.fetchMore.emit({direction: 'next', from: last(this.orgLogs)?.timestamp});
          }
        }
        this.prevLocation = location;
        this.prevLine = {} as LogRow;
        let i = 0;
        while (this.prevLine && !this.prevLine.timestamp) {
          this.prevLine = this.lines[location - i];
          i += 1;
        }
        this.prevLineOffset = Math.max(i - 1, 0);
        if (this.canRefresh !== location > this.lines.length - 30) {
          this.canRefresh = !this.canRefresh;
          this.cdr.detectChanges();
        }
      });
    }, 500);

    this.observer = new IntersectionObserver((entries => {
      this.logInView = entries[0].isIntersecting;
      this.shouldFocusLog = entries[0].isIntersecting;
    }), {threshold: 0.7});
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy() {
    this.scrollSubscription?.unsubscribe();
    this.indexSubscription?.unsubscribe();
  }

  private static getRegexFromString(filter: string) {
    try {
      const flags = filter.match(/.*\/([gimy]*)$/);
      if (flags) {
        const pattern = filter.replace(new RegExp('^/(.*?)/' + flags[1] + '$'), '$1');
        return new RegExp(pattern, flags[1]);
      }
      return new RegExp(filter, 'i');
    } catch {
      // Keep filtering usable while an incomplete expression is being typed.
      const literal = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(literal, 'i');
    }
  }

  calcLines() {
    const filteredLogs = this.orgLogs.filter(row => {
      if (!this.hasFilter) {
        return true;
      }
      this.regex.lastIndex = 0;
      return this.regex.test(row?.msg ?? '');
    });
    this.lines = buildTerminalLogRows(filteredLogs).map(line => {
      const msgHasAnsi = this.hasAnsi(line.entry);
      return {
        ...line,
        entry: msgHasAnsi ? this.convert.toHtml(line.entry) : line.entry,
        hasAnsi: msgHasAnsi,
      };
    });
  }

  trackByLineFn(index: number, line: LogRow) {
    return `${line.timestamp ?? 'continuation'}:${index}`;
  }

  reset() {
    this.initial = true;
    this.cdr.detectChanges();
  }

  getLast() {
    this.prevLine = null;
    this.prevLineOffset = 0;
    this.initial = true;
    this.fetchMore.emit({direction: 'prev'});
  }
}
