import { useDispatch, useSelector } from "react-redux";
import { setContourWheelSensitivityFactor, setMouseSensitivity, setRotationStyle, setZoomWheelSensitivityFactor } from "../../store/mouseSettings";
import { moorhen } from "../../types/moorhen";
import { MoorhenSlider } from "../inputs";
import { MoorhenStack } from "../interface-base";
import { FormControl, FormControlLabel, FormLabel, Radio, RadioGroup } from "@mui/material";

export const MouseSensitivitySettings = () => {
    const menuItemText = "Mouse sensitivity...";

    return <SensitivitySettingsPanel />;
};

const SensitivitySettingsPanel = () => {
    const mouseSensitivity = useSelector((state: moorhen.State) => state.mouseSettings.mouseSensitivity);
    const zoomWheelSensitivityFactor = useSelector((state: moorhen.State) => state.mouseSettings.zoomWheelSensitivityFactor);
    const contourWheelSensitivityFactor = useSelector((state: moorhen.State) => state.mouseSettings.contourWheelSensitivityFactor);
    const rotationStyle = useSelector((state: moorhen.State) => (state.mouseSettings as any).rotationStyle) || "trackball";

    const dispatch = useDispatch();

    return (
        <MoorhenStack gap={"1rem"}>
            <FormControl>
                <FormLabel id="pykeko-rotation-style-label" sx={{ fontSize: "0.9rem" }}>Rotation style</FormLabel>
                <RadioGroup
                    row
                    aria-labelledby="pykeko-rotation-style-label"
                    value={rotationStyle}
                    onChange={(e) => dispatch(setRotationStyle(e.target.value as "gimbal" | "trackball"))}
                >
                    <FormControlLabel
                        value="trackball"
                        control={<Radio size="small" />}
                        label="Trackball (PyMOL-style)"
                    />
                    <FormControlLabel
                        value="gimbal"
                        control={<Radio size="small" />}
                        label="Gimbal (Moorhen / Coot)"
                    />
                </RadioGroup>
            </FormControl>

            <MoorhenSlider
                minVal={0.01}
                maxVal={1.0}
                logScale={false}
                sliderTitle="Mouse sensitivity"
                stepButtons={0.01}
                externalValue={mouseSensitivity}
                setExternalValue={value => dispatch(setMouseSensitivity(value))}
                decimalPlaces={2}
            />

            <MoorhenSlider
                minVal={0.1}
                maxVal={9.9}
                logScale={false}
                sliderTitle="Mouse wheel zoom sensitivity"
                stepButtons={0.1}
                externalValue={zoomWheelSensitivityFactor}
                setExternalValue={value => dispatch(setZoomWheelSensitivityFactor(value))}
                decimalPlaces={2}
            />

            <MoorhenSlider
                minVal={0.1}
                maxVal={10}
                logScale={true}
                sliderTitle="Mouse wheel map contour sensitivity"
                externalValue={contourWheelSensitivityFactor}
                setExternalValue={value => dispatch(setContourWheelSensitivityFactor(value))}
                decimalPlaces={2}
            />
        </MoorhenStack>
    );
};
