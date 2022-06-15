import { Entity, EntityCache, RequestOptions } from 'ngx-entity-service';
import { AppInjector } from 'src/app/app-injector';
import { formatDate } from '@angular/common';
import { DoubtfireConstants } from 'src/app/config/constants/doubtfire-constants';
import { TaskDefinition, Project, Unit, TaskComment, TaskStatusEnum, TaskStatus, TaskStatusUiData, TaskService } from './doubtfire-model';
import { Grade } from './grade';
import { LOCALE_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { alertService, gradeTaskModal, UnitStudentEnrolmentModalProvider, uploadSubmissionModal } from 'src/app/ajs-upgraded-providers';

export class Task extends Entity {
  id: number;

  status: TaskStatusEnum = "not_started";
  dueDate: Date;
  extensions: number;
  submissionDate: Date;
  completionDate: Date;
  timesAssessed: number;
  grade?: number;
  qualityPts: number;
  includeInPortfolio: boolean = true;
  pctSimilar: number = 0;
  similarToCount: number = 0;
  similarToDismissedCount: number = 0;
  numNewComments: number = 0;

  readonly project: Project;
  definition: TaskDefinition;

  //TODO: map task submission details
  hasPdf: boolean = false;
  processingPdf: boolean = false;

  public topWeight: number = 0;
  public readonly commentCache: EntityCache<TaskComment> = new EntityCache<TaskComment>();

  constructor(project?: Project) {
    super();
    this.project = project;
  }

  public get comments(): TaskComment[] {
    return this.commentCache.currentValues;
  }

  public get unit(): Unit {
    return this.project.unit;
  }

  public get gradeWord(): string {
    if(this.grade)
      return Grade.GRADES[this.grade];
    else {
      return "Not Graded";
    }
  }

  public gradeDesc(): string {
    return Grade.GRADE_ACRONYMS.get(this.grade);
  }

  public hasGrade(): boolean {
    return this.grade !== undefined && this.grade !== null && (TaskStatus.GRADEABLE_STATUSES.includes(this.status));
  }

  public hasQualityPoints(): boolean {
    return this.definition.maxQualityPts > 0 && (TaskStatus.GRADEABLE_STATUSES.includes(this.status));
  }

  public localDueDate(): Date {
    if(this.dueDate) {
      return this.dueDate;
    } else {
      return this.definition.localDueDate();
    }
  }

  public localDueDateString(): string {
    const locale = AppInjector.get(LOCALE_ID);
    return formatDate(this.localDueDate(), "d MMM", locale);
  }

  public localDeadlineDate(): Date {
    return this.definition.localDeadlineDate();
  }

  /**
   * Calculate the time between two dates
   *
   * @param date1 days from this date
   * @param date2 to this date
   * @returns the time from date1 to date2
   */
   private timeBetween(date1: Date, date2: Date): number {
    return date2.getTime() - date1.getTime();
  }

  /**
   * Calculate the number of days between two dates
   *
   * @param date1 days from this date
   * @param date2 to this date
   * @returns the days from date1 to date2
   */
  private daysBetween(date1: Date, date2: Date): number {
    const diff = this.timeBetween(date1, date2);
    return Math.ceil(diff / (1000 * 3600 * 24));
  }

  public daysUntilDueDate(): number {
    return this.daysBetween(new Date(), this.localDueDate());
  }

  public daysUntilDeadlineDate() : number {
    return this.daysBetween(new Date(), this.localDeadlineDate());
  }

  public daysPastDueDate(): number {
    return this.daysBetween(this.localDueDate(), new Date());
  }

  public timePastDeadlineDate(): number {
    return this.timeBetween(this.localDeadlineDate(), new Date());
  }

  public isPastDeadline(): boolean {
    return this.timePastDeadlineDate() > 0 && ! this.inSubmittedState();
  }

  public isDueSoon(): boolean {
    return this.daysUntilDueDate() <= 7 && this.timePastDueDate() < 0 && ! this.inFinalState();
  }

  public isPastDueDate() : boolean {
    return this.timePastDueDate() > 0 && ! this.inSubmittedState();
  }

  // Is the task past the deadline
  public isOverdue() : boolean {
    return this.daysUntilDueDate() < 0;
  }

  public isDueToday(): boolean {
    return this.daysUntilDueDate() == 0 && ! this.inSubmittedState();
  }

  public timeUntilStartDate(): number {
    return this.timeBetween(new Date(), this.definition.startDate);
  }

  public daysUntilStartDate() {
    return this.daysBetween(new Date(), this.definition.startDate);
  }

  public isBeforeStartDate(): boolean {
    return this.timeUntilStartDate() > 0;
  }

  private timeToDescription(earlyTime: Date, laterTime: Date) {
    const times = [
      { period: "weeks", value: 7 * 24 * 60 * 60 * 1000.0 },
      { period: "days", value: 24 * 60 * 60 * 1000.0 },
      { period: "hours", value: 60 * 60 * 1000.0 },
      { period: "minutes", value: 60 * 1000.0 },
      { period: "seconds", value: 1000.0 }
    ];

    const timeDiff = laterTime.getTime() - earlyTime.getTime();

    if (timeDiff <= 0) {
      return "";
    }

    for (let data of times) {
      // exactDiff is floating point
      const exactDiff = timeDiff / data.value;
      const diff = Math.floor(exactDiff);

      // if days are more than 14 then show in week
      if(exactDiff > 2 && data.period === "weeks") {
        return `${diff} Weeks`;
      } else if (diff > 1 && data.period !== "weeks") {
        // Always show in days, Hours, Minutes and Seconds.
        return `${diff} ${data.period.charAt(0).toUpperCase() + data.period.substring(1)}`;
      } else if (diff === 1 && data.period !== "weeks") {
        return `1 ${data.period.charAt(0).toUpperCase() + data.period.substring(1, data.period.length - 2)}`;
      }
    };

    return `${Math.floor(timeDiff / 1000)} Seconds`;
  }


  public timeUntilDueDateDescription() {
    return this.timeToDescription(new Date(), this.localDueDate());
  }

  public timePastDueDateDescription() {
    return this.timeToDescription(this.localDueDate(), new Date());
  }


  public timeToStart(): string {
    if (this.daysUntilStartDate() < 0) {
      return "";
    } else {
      const days = this.daysUntilStartDate();
      if (days < 7) {
        return `${days}d`;
      }
      else {
        return `${Math.floor(days/7)}w`;
      }
    }
  }


  // Are we approaching the deadline?
  public isDeadlineSoon() {
    return this.daysUntilDeadlineDate() <= 14 && this.timePastDeadlineDate() < 0 && ! this.inFinalState();
  }

  public betweenDueDateAndDeadlineDate(): boolean {
    const now = new Date().getTime();

    return (now > this.localDueDate().getTime()) && now < this.localDeadlineDate().getTime();
  }

  public timePastDueDate() {
    return this.timeBetween(this.localDueDate(), new Date());
  }

  public refreshCommentData(): void {
    const comments: TaskComment[] = this.comments;
    if(comments.length === 0) return;

    comments[0].shouldShowTimestamp = true

    // for i in [0...comments.length]
    //   authorID = comments[i].author.id
    //   timeOfMessage = comments[i].created_at

    //   # if the comment is proceeded by a different author's comment, or the time between comments
    //   # is significant, mark it as start of end of series, then start a new series proceeding.
    //   if (authorID != comments[i+1]?.author.id || hoursBetween(timeOfMessage, comments[i+1]?.created_at) > 3) # IDs match
    //     comments[i].shouldShowAvatar = true
    //     comments[i+1]?.shouldShowTimestamp = true
    //   else
    //     comments[i].shouldShowAvatar = false
    //     comments[i+1]?.shouldShowTimestamp = false

    //   # if the comment is preceeded by a non-conent comment, mark it as start of series.
    //   if (comments[i].isBubbleComment && !comments[i-1]?.isBubbleComment)
    //     comments[i].firstInSeries = true

    //   # if the comment is proceeded by a non-conent comment, mark it as end of series.
    //   if (comments[i].isBubbleComment && !comments[i+1]?.isBubbleComment)
    //     comments[i].shouldShowAvatar = true

    //   # Link in original messages for replies
    //   if (comments[i].replyToId)
    //     comments[i].originalComment = comments.find((tc) -> tc.id == comments[i].replyToId)

    // comments[comments.length-1].shouldShowAvatar = true
    // comments
  }

  public taskKey(): { studentId: number; taskDefAbbr: string; } {
    return {
      studentId: this.project.student.id,
      taskDefAbbr: this.definition.abbreviation
    };
  }

  public taskKeyToIdString(): string {
    const key = this.taskKey();
    return `task-key-${key.studentId}-${key.taskDefAbbr}`.replace(/[.#]/g, "-");
  }

  public plagiarismDetected(): boolean {
    return this.similarToCount - this.similarToDismissedCount > 0;
  }

  public inFinalState(): boolean {
    return TaskStatus.FINAL_STATUSES.indexOf(this.status) >= 0;
  }

  public inCompleteState(): boolean {
    return this.status === 'complete';
  }

  public inTimeExceeded(): boolean {
    return this.status === 'time_exceeded';
  }

  public isValidTopTask(): boolean {
    return TaskStatus.VALID_TOP_TASKS.indexOf(this.status) >= 0;
  }

  public inSubmittedState(): boolean {
    return TaskStatus.SUBMITTED_STATUSES.includes(this.status);
  }

  public inAwaitingFeedbackState(): boolean {
    return this.status === "ready_for_feedback";
  }

  public statusLabel(): string {
    return TaskStatus.STATUS_LABELS.get(this.status);
  }

  public statusIcon(): string {
    return TaskStatus.STATUS_ICONS.get(this.status);
  }

  public statusClass(): string {
    return TaskStatus.statusClass(this.status);
  }

  public statusHelp(): { detail: string; reason: string; action: string; } {
    return TaskStatus.HELP_DESCRIPTIONS.get(this.status);
  }

  public filterFutureStates(states: TaskStatusUiData[]): TaskStatusUiData[] {
    return states.filter((s: TaskStatusUiData): boolean => {
      const rejectStates = TaskStatus.REJECT_FUTURE_STATES.get(this.status);
      return ! rejectStates.includes(s.status);
    });
  }

  public isGroupTask(): boolean {
    return this.definition.isGroupTask();
  }

  public getSubmissionDetails(): void {
    //TODO: implement
    console.log("implement get submission details");

    this.hasPdf = false; //response.has_pdf
    this.processingPdf = false; //response.processing_pdf
    this.submissionDate = new Date(); //response.submission_date
  }

  public submissionUrl(asAttachment: boolean = false): string {
    return `${AppInjector.get(DoubtfireConstants).API_URL}/projects/${this.project.id}/task_def_id/${this.definition.id}/submission${ asAttachment ? "?as_attachment=true" : "" }`;
  }

  public testSubmissionUrl(): string {
    return `${AppInjector.get(DoubtfireConstants).API_URL}/units/${this.unit.id}/task_definitions/${this.definition.id}/test_overseer_assessment`;
  }

  public submittedFilesUrl(asAttachment: boolean = false) : string {
    return `${AppInjector.get(DoubtfireConstants).API_URL}/projects/${this.project.id}/task_def_id/${this.definition.id}/submission_files${ asAttachment ? "?as_attachment=true" : "" }`;
  }

  public recreateSubmissionPdf(): Observable<object> {
    const httpClient: HttpClient = AppInjector.get(HttpClient);
    const url = `${AppInjector.get(DoubtfireConstants).API_URL}/projects/${this.project.id}/task_def_id/${this.definition.id}/submission`;

    return httpClient.put(url, {});
  }

  public requiresFileUpload(): boolean {
    return this.definition.uploadRequirements.length > 0;
  }

  // Trigger for new status
  // taskService.triggerTransition = (task, status, unitRole) ->
  //   throw Error "Not a valid status key" unless _.includes(taskService.statusKeys, status)
  //   return if task.status == status
  //   requiresFileUpload = _.includes(['ready_for_feedback', 'need_help'], status) && task.requiresFileUpload()
  //   if requiresFileUpload
  //     taskService.presentTaskSubmissionModal(task, status)
  //   else
  //     taskService.updateTaskStatus(task.unit(), task.project(), task, status)
  //     asUser = if unitRole? then unitRole.role else 'Student'
  //     analyticsService.event('Task Service', "Updated Status as #{asUser}", taskService.statusLabels[status])

  public presentTaskSubmissionModal(status: TaskStatusEnum, reuploadEvidence: boolean = false, isTestSubmission: boolean = false) {
    const oldStatus = this.status;

    if (!isTestSubmission) {
      this.status = status;
    }
    const uploadModal: any = AppInjector.get(uploadSubmissionModal);

    const modal = uploadModal.show(this, reuploadEvidence, isTestSubmission);
    // Modal failed to present
    if(!modal) {
      if (!isTestSubmission) {
        this.status = oldStatus;
      }
      return;
    }

    modal.result.then(
      // Grade was selected (modal closed with result)
      (response) => {},
      // Grade was not selected (modal was dismissed)
      (dismissed) => {
        if (!isTestSubmission) {
          this.status = oldStatus;
        }
        const alerts: any = AppInjector.get(alertService);
        alerts.add("info", "Submission cancelled. Status was reverted.", 6000);
      }
    );
  }

  public processTaskStatusChange(expectedStatus: TaskStatusEnum, alerts: any) {
    if (this.inTimeExceeded() && !this.isPastDeadline()) {
      alerts.add('warning', "Request an extension, or wait for your extension request to be granted, to get feedback on this task.", 6000);
    }

    if (this.status !== expectedStatus) {
      alerts.add("info", `Status changed to ${this.statusLabel()}.`, 4000);
    } else {
      alerts.add("success", "Status saved.", 2000);
    }

  }

  private updateTaskStatus(status: TaskStatusEnum) {
    const oldStatus = this.status;
    const alerts: any = AppInjector.get(alertService);

    const updateFunc = () => {
      const taskService: TaskService = AppInjector.get(TaskService);
      const options: RequestOptions<Task> = {
        entity: this,
        cache: this.project.taskCache,
        body: {
          trigger: status,
          grade: this.grade,
          qualityPts: this.qualityPts
        }
      };

      taskService.update( {
        projectId: this.project.id,
        taskDefId: this.definition.id,
      }, options ).subscribe({
        next: (response) => {
          this.processTaskStatusChange(status, alerts);
        },
        error: (error) => {
          this.status = oldStatus;
          alerts.add("danger", error, 6000)
        }
      });
    }; // end update function

    // Must provide grade if graded and in a final complete state
    if ((this.definition.isGraded || this.definition.maxQualityPts > 0) && TaskStatus.GRADEABLE_STATUSES.includes(status)) {
      const gradeModal: any = AppInjector.get(gradeTaskModal);
      const modal = gradeModal.show(this);
      if (modal) {
        modal.result.then(
          // Grade was selected (modal closed with result)
        (response) => {
          this.grade = response.selectedGrade;
          this.qualityPts = response.qualityPts;
          updateFunc();
        },
        // Grade was not selected (modal was dismissed)
        () => {
          this.status = oldStatus;
          alerts.add("info", "Status reverted, as no grade was specified", 6000);
        })
      }
    } else {
      updateFunc();
    }
  }

  public triggerTransition(status: TaskStatusEnum): void {
    if(this.status === status) return;

    const requiresFileUpload = ['ready_for_feedback', 'need_help'].includes(status) && this.requiresFileUpload();

    if (requiresFileUpload) {
      this.presentTaskSubmissionModal(status);
    }
    else {
      this.updateTaskStatus(status);
    }
  }

  public staffAlignments() {
    return this.unit.taskOutcomeAlignments.find
  }
}