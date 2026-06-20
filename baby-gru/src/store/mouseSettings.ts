import { createSlice } from "@reduxjs/toolkit";

const initialState: {
    contourWheelSensitivityFactor: number;
    zoomWheelSensitivityFactor: number;
    mouseSensitivity: number;
    // PyKeko v0.2.47 — rotation paradigm. "gimbal" is Moorhen's original
    // Eulerian yaw-pitch (horizontal-drag-only-yaws, vertical-only-pitches).
    // "trackball" is the PyMOL-style Shoemake arcball: cursor projected onto
    // a virtual hemisphere; drag rotates the visible side of the ball, so
    // diagonal drags rotate about the perpendicular diagonal axis and edge
    // drags include some natural roll. Default is "trackball" because the
    // sample of users we have (one) is more PyMOL-acclimated.
    rotationStyle: "gimbal" | "trackball";
} = {
    zoomWheelSensitivityFactor: null,
    mouseSensitivity: null,
    contourWheelSensitivityFactor: null,
    rotationStyle: "trackball",
};

const defaultMouseSettingsSlice = createSlice({
    name: "mouseSettings",
    initialState: initialState,
    reducers: {
        // API
        resetDefaultMouseSettings: () => {
            return initialState;
        },
        // API
        setZoomWheelSensitivityFactor: (state, action: { payload: number; type: string }) => {
            return { ...state, zoomWheelSensitivityFactor: action.payload };
        },
        // API
        setMouseSensitivity: (state, action: { payload: number; type: string }) => {
            return { ...state, mouseSensitivity: action.payload };
        },
        // API
        setContourWheelSensitivityFactor: (state, action: { payload: number; type: string }) => {
            return { ...state, contourWheelSensitivityFactor: action.payload };
        },
        // API
        setRotationStyle: (state, action: { payload: "gimbal" | "trackball"; type: string }) => {
            return { ...state, rotationStyle: action.payload };
        },
    },
});

export const { setContourWheelSensitivityFactor, setZoomWheelSensitivityFactor, setMouseSensitivity, setRotationStyle, resetDefaultMouseSettings } =
    defaultMouseSettingsSlice.actions;

export default defaultMouseSettingsSlice.reducer;
