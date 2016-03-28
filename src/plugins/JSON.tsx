import * as React from "react";
import Job from "../Job";
import PluginManager from "../PluginManager";
const JsonTree = require("../../../decorators/json");

PluginManager.registerOutputDecorator({
    decorate: (job: Job): React.ReactElement<any> => {
        return <JsonTree data={JSON.parse(job.buffer.toString())}/>;
    },

    isApplicable: (job: Job): boolean => {
        try {
            JSON.parse(job.buffer.toString());
            return true;
        } catch (exception) {
            return false;
        }
    },
});
