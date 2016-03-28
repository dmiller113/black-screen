import * as _ from "lodash";
import * as e from "../Enums";
import * as React from "react";
import AutocompleteComponent from "./AutocompleteComponent";
import DecorationToggleComponent from "./DecorationToggleComponent";
import History from "../History";
import {stopBubblingUp, keys, getCaretPosition, setCaretPosition, withModifierKey, isSpecialKey} from "./ViewUtils";
import JobComponent from "./3_JobComponent";
import PromptModel from "../Prompt";
import JobModel from "../Job";
import {Suggestion} from "../plugins/autocompletion_providers/Suggestions";
import {KeyCode} from "../Enums";
import {Subject} from "rxjs/Subject";
import "rxjs/add/operator/filter";
import "rxjs/add/operator/map";
const reactDOM = require("react-dom");

interface Props {
    job: JobModel;
    status: e.Status;
    jobView: JobComponent;
    hasLocusOfAttention: boolean;
}

interface State {
    highlightedSuggestionIndex?: number;
    latestKeyCode?: number;
    suggestions?: Suggestion[];
}


// TODO: Make sure we only update the view when the model changes.
export default class PromptComponent extends React.Component<Props, State> implements KeyDownReceiver {
    private prompt: PromptModel;
    private handlers: {
        onKeyDown: Function;
    };

    constructor(props: Props) {
        super(props);
        this.prompt = this.props.job.prompt;

        this.state = {
            suggestions: [],
            highlightedSuggestionIndex: 0,
            latestKeyCode: undefined,
        };

        const keyDownSubject: Subject<KeyboardEvent> = new Subject();


        keyDownSubject // Should be before setting latestKeyCode.
            .filter((event: KeyboardEvent) => event.keyCode === KeyCode.Period && (event.altKey || this.state.latestKeyCode === KeyCode.Escape))
            .forEach(this.appendLastLexemeOfPreviousJob, this);

        keyDownSubject
            .filter(_.negate(withModifierKey))
            .forEach((event: KeyboardEvent) => this.setState({latestKeyCode: event.keyCode}), this);


        const promptKeys = keyDownSubject.filter(() => this.props.status !== e.Status.InProgress)
            .filter(isSpecialKey)
            .map(stopBubblingUp);
        promptKeys
            .filter(() => this.isAutocompleteShown())
            .filter(keys.tab)
            .forEach(this.applySuggestion, this);
        promptKeys
            .filter(keys.deleteWord).forEach(() => this.deleteWord(), this);
        promptKeys
            .filter(keys.enter).forEach(this.execute, this);
        promptKeys
            .filter(keys.interrupt).forEach(() => this.prompt.setValue("").then(() => this.setDOMValueProgrammatically("")), this);
        promptKeys
            .filter((event: KeyboardEvent) => keys.goDown(event) || keys.goUp(event))
            .filter(() => this.isAutocompleteShown())
            .forEach(this.navigateAutocomplete, this);
        promptKeys
            .filter((event: KeyboardEvent) => keys.goDown(event) || keys.goUp(event))
            .filter(() => !this.isAutocompleteShown())
            .forEach(this.navigateHistory, this);

        this.handlers = {
            onKeyDown: (event: KeyboardEvent) => keyDownSubject.next(event),
        };

        // FIXME: find a better design to propagate events.
        if (this.props.hasLocusOfAttention) {
            window.promptUnderAttention = this;
        }
    }

    handleKeyDown(event: KeyboardEvent): void {
      if (!(this.isKeyModified(event)) || (event.ctrlKey && event.key == 'v'))
        this.commandNode.focus();
    }

    componentDidMount() {
        $(reactDOM.findDOMNode(this)).fixedsticky();
        $(".fixedsticky-dummy").remove();

        const node = this.commandNode;
        node.focus();
        node.addEventListener("paste", (event: ClipboardEvent) => {
            event.preventDefault();

            const text = event.clipboardData.getData("text/plain");

            if (this.props.status === e.Status.InProgress) {
                this.props.job.write(text);
            } else {
                document.execCommand("insertHTML", false, text);
            }
        });
    }

    componentDidUpdate(prevProps: Props, prevState: State) {
        if (this.props.status !== e.Status.NotStarted) {
            return;
        }

        if (!prevProps.hasLocusOfAttention && this.props.hasLocusOfAttention) {
            this.commandNode.focus();
        }

        // FIXME: find a better design to propagate events.
        if (this.props.hasLocusOfAttention) {
            window.promptUnderAttention = this;
        }
    }

    render() {
        const classes = ["prompt-wrapper", "fixedsticky", this.props.status].join(" ");
        // FIXME: write better types.
        let autocomplete: any;
        let autocompletedPreview: any;
        let inlineSynopsis: any;
        let decorationToggle: any;
        let scrollToTop: any;

        if (this.showAutocomplete()) {
            autocomplete = <AutocompleteComponent suggestions={this.state.suggestions}
                                                  caretOffset={$(this.commandNode).caret("offset")}
                                                  onSuggestionHover={this.highlightSuggestion.bind(this)}
                                                  onSuggestionClick={this.applySuggestion.bind(this)}
                                                  highlightedIndex={this.state.highlightedSuggestionIndex}
                                                  ref="autocomplete"/>;
            const completed = this.valueWithCurrentSuggestion;
            if (completed.trim() !== this.prompt.value && completed.startsWith(this.prompt.value)) {
                autocompletedPreview = <div className="autocompleted-preview">{completed}</div>;
            } else {
                const highlightedSuggestion = this.state.suggestions[this.state.highlightedSuggestionIndex];
                if (highlightedSuggestion.synopsis) {
                    inlineSynopsis = <div className="inline-synopsis">{this.prompt.value} —— {highlightedSuggestion.synopsis}</div>;
                }
            }
        }

        if (this.props.jobView.state.canBeDecorated) {
            decorationToggle = <DecorationToggleComponent job={this.props.jobView}/>;
        }

        if (this.props.status !== e.Status.NotStarted && this.props.job.buffer.size > 100) {
            scrollToTop = <a className="scroll-to-top" onClick={this.handleScrollToTop.bind(this)}><i className="fa fa-long-arrow-up"/></a>;
        }

        return (
            <div className={classes}>
                <div className="arrow"></div>
                <div className="prompt-info" title={JSON.stringify(this.props.status)}></div>
                <div className={"prompt"}
                     onKeyDown={this.handlers.onKeyDown.bind(this)}
                     onInput={this.handleInput.bind(this)}
                     onKeyPress={this.handleKeyPress.bind(this)}
                     type="text"
                     ref="command"
                     contentEditable={this.props.status === e.Status.NotStarted || this.props.status === e.Status.InProgress}></div>
                {autocompletedPreview}
                {inlineSynopsis}
                {autocomplete}
                <div className="actions">
                    {decorationToggle}
                    {scrollToTop}
                </div>
            </div>
        );
    }

    private execute(): void {
        if (!this.isEmpty()) {
            this.prompt.execute();
        }
    }

    private get commandNode(): HTMLInputElement {
        /* tslint:disable:no-string-literal */
        return this.refs["command"] as HTMLInputElement;
    }

    private setDOMValueProgrammatically(text: string): void {
        this.commandNode.innerText = text;
        setCaretPosition(this.commandNode, text.length);

        this.forceUpdate();
    }

    private async deleteWord(current = this.prompt.value, position = getCaretPosition(this.commandNode)): Promise<void> {
        if (!current.length) {
            return;
        }

        const lastIndex = current.substring(0, position).lastIndexOf(" ");
        const endsWithASpace = lastIndex === current.length - 1;

        current = current.substring(0, lastIndex);

        if (endsWithASpace) {
            this.deleteWord(current, position);
        } else {
            if (current.length) {
                current += " ";
            }

            await this.prompt.setValue(current + this.prompt.value.substring(getCaretPosition(this.commandNode)));
            this.setDOMValueProgrammatically(this.prompt.value);
        }
    }

    private isEmpty(): boolean {
        return this.prompt.value.replace(/\s/g, "").length === 0;
    }

    private isKeyModified(event: KeyboardEvent): boolean {
      return (event.ctrlKey || event.metaKey || event.altKey)
    }

    private async navigateHistory(event: KeyboardEvent): Promise<void> {
        let newValue = keys.goUp(event) ? History.getPrevious() : History.getNext();

        await this.prompt.setValue(newValue);
        this.setDOMValueProgrammatically(newValue);
    }

    private async appendLastLexemeOfPreviousJob(event: KeyboardEvent): Promise<void> {
        event.stopPropagation();
        event.preventDefault();

        const value = this.prompt.value + History.lastEntry.lastLexeme;
        await this.prompt.setValue(value);
        this.setDOMValueProgrammatically(value);
    }

    private highlightSuggestion(index: number): void {
        this.setState({highlightedSuggestionIndex: index});
    }

    private navigateAutocomplete(event: KeyboardEvent): void {
        let index: number;
        if (keys.goUp(event)) {
            index = Math.max(0, this.state.highlightedSuggestionIndex - 1);
        } else {
            index = Math.min(this.state.suggestions.length - 1, this.state.highlightedSuggestionIndex + 1);
        }

        this.highlightSuggestion(index);
    }

    private async applySuggestion(): Promise<void> {
        await this.prompt.setValue(this.valueWithCurrentSuggestion);
        this.setDOMValueProgrammatically(this.prompt.value);

        this.prompt.getSuggestions().then(suggestions =>
            this.setState({suggestions: suggestions, highlightedSuggestionIndex: 0})
        );
    }

    private get valueWithCurrentSuggestion(): string {
        let state = this.state;
        const suggestion = state.suggestions[state.highlightedSuggestionIndex];

        // FIXME: replace the current lexeme prefix.
        const prefixLength = suggestion.getPrefix(this.props.job).length;
        const caretPosition = getCaretPosition(this.commandNode);
        const valueUpToCaret = this.prompt.value.slice(0, caretPosition);
        const valueFromCaret = this.prompt.value.slice(caretPosition);
        let valueWithoutPrefix = prefixLength ? valueUpToCaret.slice(0, -prefixLength) : valueUpToCaret;

        let newValue = valueWithoutPrefix + suggestion.value;
        if (!suggestion.partial && newValue.slice(-1) !== " " && valueFromCaret[0] !== " ") {
            newValue += " ";
        }


        return newValue + valueFromCaret;
    }

    private showAutocomplete(): boolean {
        // TODO: use streams.
        return this.props.hasLocusOfAttention &&
            this.state.suggestions.length &&
            this.commandNode && !this.isEmpty() &&
            this.props.status === e.Status.NotStarted && ![KeyCode.CarriageReturn, KeyCode.Escape].includes(this.state.latestKeyCode);
    }

    private isAutocompleteShown(): boolean {
        /* tslint:disable:no-string-literal */
        return !!this.refs["autocomplete"];
    }

    private async handleInput(event: React.SyntheticEvent): Promise<void> {
        await this.prompt.setValue((event.target as HTMLElement).innerText);

        // TODO: remove repetition.
        // TODO: make it a stream.
        this.prompt.getSuggestions().then(suggestions =>
            this.setState({suggestions: suggestions, highlightedSuggestionIndex: 0})
        );
    }

    private handleScrollToTop(event: Event) {
        stopBubblingUp(event);

        const offset = $(reactDOM.findDOMNode(this.props.jobView)).offset().top - 10;
        $("html, body").animate({scrollTop: offset}, 300);
    }

    private handleKeyPress(event: Event) {
        if (this.props.status === e.Status.InProgress) {
            stopBubblingUp(event);
        }
    }
}
