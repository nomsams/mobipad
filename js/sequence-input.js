function bindStepEditing(button, edit, isErasing = () => false) {
  button.addEventListener("click", (event) => {
    if (event.button === void 0 || event.button === 0) edit(!isErasing());
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    edit(false);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      edit(false);
    } else if (event.key === " " || event.key === "Enter") event.stopPropagation();
  });
}
export {
  bindStepEditing
};
