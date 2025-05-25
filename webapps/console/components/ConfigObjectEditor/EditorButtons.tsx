import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Popover } from "antd";
import { CheckOutlined, LoadingOutlined } from "@ant-design/icons";
import { getLog } from "juava";
import { ConfigTestResult } from "./ConfigEditor";
import { useAppConfig } from "../../lib/context";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";

const log = getLog("ConfigEditor");

export type EditorButtonProps<T extends { id: string } = { id: string }> = {
  isNew: boolean;
  loading: boolean;
  testing: boolean;
  onDelete: () => void;
  onTest?: () => Promise<ConfigTestResult>;
  onCancel: () => void;
  onSave: () => void;
  isTouched?: boolean;
  hasErrors?: boolean;
  testStatus?: string;
  testButtonLabel?: string;
};

export const EditorButtons: React.FC<EditorButtonProps> = ({
  isNew,
  loading,
  testing,
  onCancel,
  onDelete,
  onTest,
  onSave,
  isTouched,
  hasErrors,
  testButtonLabel = "Test Connection",
}) => {
  const buttonDivRef = useRef<HTMLDivElement>(null);
  const appConfig = useAppConfig();
  const readOnly = !!appConfig.readOnlyUntil;

  const [testStatus, setTestStatus] = useState<string>("");

  useEffect(() => {
    function handleKeyDown(e) {
      setTestStatus("");
    }
    document.addEventListener("keydown", handleKeyDown);

    return function cleanup() {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const doTest = async (obj: any) => {
    if (onTest) {
      setTestStatus("pending");
      try {
        const testRes = await onTest();
        log.atDebug().log("Test result", testRes);
        if (testRes.ok) {
          setTestStatus("success");
        } else {
          setTestStatus(testRes?.error || "unknown error");
        }
      } catch (e) {
        setTestStatus("failed to test connection: " + e);
      } finally {
        setTimeout(() => {
          buttonDivRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      }
    }
  };

  return (
    <>
      {!loading && testStatus && testStatus !== "success" && testStatus !== "pending" && (
        <Alert
          message="Test failed"
          className={"whitespace-pre-wrap"}
          description={testStatus}
          type="error"
          showIcon
          closable
        />
      )}
      {testing && <Alert message="Testing connection..." type="info" />}
      <div className="flex justify-between mt-4">
        <div>
          {!isNew && (
            <Button disabled={loading || readOnly} type="primary" ghost danger size="large" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
        <div className="flex justify-end space-x-5" ref={buttonDivRef}>
          {onTest &&
            (testStatus === "success" ? (
              <Popover content={"Test passed"} color={"lime"} trigger={"click"} defaultOpen={true}>
                <Button type="link" disabled={loading || testing} size="large" onClick={doTest}>
                  <CheckOutlined />
                  {testButtonLabel}
                </Button>
              </Popover>
            ) : (
              <Button type="link" disabled={loading} size="large" onClick={doTest}>
                {testStatus === "pending" ? (
                  <ButtonLabel icon={<LoadingOutlined className="w-4 h-4" />}>{testButtonLabel}</ButtonLabel>
                ) : (
                  testButtonLabel
                )}
              </Button>
            ))}
          <Button type="primary" ghost size="large" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="primary"
            size="large"
            loading={loading}
            disabled={(isTouched !== undefined && !isTouched) || readOnly}
            htmlType={isTouched && !hasErrors ? "submit" : "button"}
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </div>
    </>
  );
};
