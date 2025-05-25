import { WorkspacePageLayout } from "../../../components/PageLayout/WorkspacePageLayout";
import React from "react";
import ConnectionEditorPage from "../../../components/ConnectionEditorPage/ConnectionEditorPage";
import { FunctionConfig } from "../../../lib/schema";
import { useConfigObjectLinks, useConfigObjectList } from "../../../lib/store";
import { z } from "zod";
import { ConfigurationObjectLinkDbModel } from "../../../prisma/schema";

type FunctionAPIResult = {
  functions: FunctionConfig[];
  isLoading: boolean;
  error: any;
};
const Loader = () => {
  const links = useConfigObjectLinks({ withData: true });
  const streams = useConfigObjectList("stream");
  const destinations = useConfigObjectList("destination");
  const functions = useConfigObjectList("function").filter(f => f.kind !== "profile");
  return (
    <ConnectionEditorPage
      streams={streams}
      destinations={destinations}
      links={links as z.infer<typeof ConfigurationObjectLinkDbModel>[]}
      functions={functions}
    />
  );
};

const RootComponent: React.FC = () => {
  return (
    <WorkspacePageLayout>
      <div className="flex justify-center">
        <Loader />
      </div>
    </WorkspacePageLayout>
  );
};

RootComponent.displayName = "ConnectionEditorPage";

export default RootComponent;
