import "./app.css";
import { MoorhenApp } from "./components/MoorhenApp";
import { MoorhenLogConsole } from "./components/MoorhenLogConsole";

function App() {
    return (
        <div className="App">
            <MoorhenApp />
            {/* PyKeko v0.2.44: thin always-on log strip at the very bottom
                of the viewport. Tails /tmp/pykeko.log (renderer console +
                main-process IPC events). Click strip or ⌘` to expand. */}
            <MoorhenLogConsole />
        </div>
    );
}

export default App;
