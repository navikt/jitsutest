import { useQueryStringState } from "../../lib/useQueryStringState";
import JSON5 from "json5";
import { Tabs, TabsProps } from "antd";
import React, { useCallback } from "react";
import { EventsBrowser } from "./EventsBrowser";

export type DataViewState = {
  activeView: "incoming" | "function" | "bulker";
  viewState: Record<"incoming" | "function" | "bulker", any>;
};

export function DataView() {
  const defaultState: DataViewState = {
    activeView: "incoming",
    //state of nested Tab
    viewState: {
      incoming: {},
      function: {},
      bulker: {},
    },
  };
  const [state, setState] = useQueryStringState<DataViewState>(`query`, {
    defaultValue: defaultState,
    parser: (value: string) => {
      return JSON5.parse(value);
    },
    serializer: (value: DataViewState) => {
      return JSON5.stringify(value);
    },
  });

  const changeActiveView = (activeView: string) =>
    setState({ ...state, activeView: activeView as DataViewState["activeView"] });

  const patchQueryStringState = useCallback(
    (key: string, value: any) => {
      if (state.viewState[state.activeView]?.[key] === value) return;
      if (value === null) {
        const newState = { ...state };
        delete newState[key];
        setState(newState);
      } else {
        setState({
          ...state,
          viewState: { ...state.viewState, [state.activeView]: { ...state.viewState[state.activeView], [key]: value } },
        });
      }
    },
    [setState, state]
  );

  const items: TabsProps["items"] = [
    {
      key: "incoming",
      label: `Incoming Events`,
      children: (
        <EventsBrowser
          {...state.viewState.incoming}
          streamType={"incoming"}
          patchQueryStringState={patchQueryStringState}
        />
      ),
    },
    {
      key: "function",
      label: `API Destinations & Functions Logs`,
      children: (
        <EventsBrowser
          {...state.viewState.function}
          streamType={"function"}
          patchQueryStringState={patchQueryStringState}
        />
      ),
    },
    {
      key: "bulker",
      label: `Batches & Data Warehouse Events`,
      children: (
        <EventsBrowser
          {...state.viewState.bulker}
          streamType={"bulker"}
          patchQueryStringState={patchQueryStringState}
        />
      ),
    },
    // {
    //   key: "sql",
    //   label: `SQL Viewer`,
    //   children: <SQLViewer patchQueryStringState={patchQueryStringState} />,
    // },
  ];
  return (
    <Tabs
      defaultActiveKey={state.activeView}
      onChange={changeActiveView}
      destroyInactiveTabPane={true}
      type="line"
      items={items}
    />
  );
}
