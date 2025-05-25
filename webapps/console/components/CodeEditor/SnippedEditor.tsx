import React from "react";
import { Radio } from "antd";
import { editor } from "monaco-editor";
import { CodeEditor } from "./CodeEditor";

/**
 * See tagDestination comments, due to limitations of the react-jsonschema-form we can't use
 * an object as a value, so we have to use a string.
 */
export type SnippedEditorValue = string;

type SupportedLanguages = "html" | "javacript" | "json" | "text";
export type SnippedEditorParsed = {
  lang: SupportedLanguages;
  code?: string;
};

export type SnippedEditorProps = {
  value: SnippedEditorValue;
  languages?: SupportedLanguages[];
  height?: number;
  onChange: (value: SnippedEditorValue) => void;
  monacoOptions?: editor.IStandaloneEditorConstructionOptions;
  //automatically fold code on provided level of indentation on editor mount
  foldLevel?: number;
  syntaxCheck?: {
    json?: boolean;
  };
};

/**
 * To support historical values which were plain strings
 * @param val
 */
function parse(val: string) {
  try {
    const j = JSON.parse(val);
    if (j.lang) {
      return j;
    } else {
      return { code: val, lang: "json" };
    }
  } catch (e) {
    return { code: val, lang: "javascript" };
  }
}

export const SnippedEditor: React.FC<SnippedEditorProps> = props => {
  const [value, setValue] = React.useState<SnippedEditorValue>(props.value);

  const valueParsed = value
    ? (parse(value) as SnippedEditorParsed)
    : { lang: props.languages?.[0] || "text", code: "" };
  const singleLanguage = props.languages && props.languages.length === 1;
  return (
    <div>
      {!singleLanguage && (
        <div className="text-right mb-4">
          <Radio.Group
            options={props.languages || ["text"]}
            value={valueParsed.lang}
            onChange={e => {
              const newValue = JSON.stringify({
                ...valueParsed,
                lang: e.target.value.toLowerCase() as SupportedLanguages,
              });
              setValue(newValue);
              props.onChange(newValue);
            }}
          />
        </div>
      )}
      <div className={`border border-textDisabled`}>
        <CodeEditor
          language={valueParsed.lang?.toLowerCase() || "html"}
          height={props.height ? `${props.height}px` : "500px"}
          value={valueParsed.code || ""}
          onChange={code => {
            if (singleLanguage) {
              props.onChange(code || "");
            } else {
              const newValue = JSON.stringify({ ...valueParsed, code });
              setValue(newValue);
              props.onChange(newValue);
            }
          }}
          foldLevel={props.foldLevel}
          syntaxCheck={props.syntaxCheck}
          monacoOptions={{
            lineNumbers: "off",
            ...(props.monacoOptions || {}),
          }}
        />
      </div>
    </div>
  );
};
