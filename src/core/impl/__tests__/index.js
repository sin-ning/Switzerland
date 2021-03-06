import test from 'ava';
import { stub, spy, match } from 'sinon';
import starwars from 'starwars';
import createState from '../../state/index.js';
import createQueue from '../../queue/index.js';
import * as impl from '../index.js';
import * as u from '../../utils.js';

class MockExtension {}

test.beforeEach(t => {
    const Implementation = impl.base(MockExtension, []);
    const instance = (t.context.instance = new Implementation());
    const queue = createQueue();
    const state = createState(instance);
    instance.isConnected = true;
    instance[impl.meta].queue = queue;
    instance[impl.meta].state = state;
    const querySelectorAll = (instance.querySelectorAll = spy());
    const dispatchEvent = (instance.dispatchEvent = spy());
    const classList = (instance.classList = {
        add: spy(),
        remove: spy()
    });
    t.context.spies = { querySelectorAll, dispatchEvent, classList };
    t.context.injectors = { queue, state };
});

test('It should render when the element is mounted;', t => {
    const { instance } = t.context;
    const renderSpy = stub(instance, 'render');
    instance.connectedCallback();
    t.is(renderSpy.callCount, 1);
});

test('It should render and remove the class name when the element is unmounted;', t => {
    const { instance, spies } = t.context;
    stub(instance, 'render');
    instance.disconnectedCallback();
    t.is(spies.classList.remove.callCount, 1);
    t.true(spies.classList.remove.calledWith('resolved'));
});

test('It should not render the component when in an error state;', async t => {
    const { instance, injectors } = t.context;
    injectors.state.setError();
    await instance.render();
    t.true(injectors.state.isError());
    t.true(injectors.queue.isEmpty());
});

test.serial(
    'It should be able to enqueue render passes and process them consecutively;',
    async t => {
        const { instance, spies } = t.context;
        const renderSpy = spy(instance, 'render');
        const handleMiddlewareStub = stub(u, 'handleMiddleware').resolves();
        const firstTask = instance.render();
        const secondTask = instance.render();
        const thirdTask = instance.render();
        t.is(renderSpy.callCount, 3);
        await firstTask;
        t.is(spies.dispatchEvent.callCount, 1);
        await secondTask;
        t.is(spies.dispatchEvent.callCount, 2);
        await thirdTask;
        t.is(spies.dispatchEvent.callCount, 3);
        handleMiddlewareStub.restore();
    }
);

test('It should dispatch the resolved event and add the class name when rendered;', async t => {
    const { instance, spies } = t.context;
    await instance.render();
    t.is(spies.classList.add.callCount, 1);
    t.true(spies.classList.add.calledWith('resolved'));
    t.is(spies.dispatchEvent.callCount, 1);
});

test('It should not add the class name when the element is disconnected from the page', async t => {
    const { instance, spies } = t.context;
    instance.isConnected = false;
    await instance.render();
    t.is(spies.classList.add.callCount, 0);
});

test('It should drop the task from the queue upon completion;', async t => {
    const { instance, injectors } = t.context;
    const task = instance.render();
    t.false(injectors.queue.isInvalid(task));
    t.false(injectors.queue.isEmpty());
    await task;
    t.true(injectors.queue.isInvalid(task));
    t.true(injectors.queue.isEmpty());
});

test.serial(
    'It should remain in the normal state when a render pass is cancelled;',
    async t => {
        const { instance, injectors } = t.context;
        const getInitialPropsStub = stub(u, 'getInitialProps').throws(
            () => new impl.CancelError()
        );
        const setErrorSpy = spy(injectors.state, 'setError');
        await instance.render();
        t.is(setErrorSpy.callCount, 0);
        getInitialPropsStub.restore();
    }
);

test.serial('It should be able to handle errors gracefully;', async t => {
    const { instance, injectors, spies } = t.context;
    const handleMiddlewareStub = stub(u, 'handleMiddleware').throws(
        () => new Error('Yoko Onoooo...')
    );
    const handleErrorStub = stub(u, 'handleError');
    await instance.render();
    t.true(injectors.queue.isEmpty());
    t.true(injectors.state.isError());
    t.is(handleErrorStub.callCount, 1);
    t.is(spies.dispatchEvent.callCount, 1);
    handleMiddlewareStub.restore();
    handleErrorStub.restore();
});

test('It should delegate all method invocations to the instance when aliasing;', t => {
    const { instance } = t.context;
    const Implementation = impl.alias(MockExtension, instance);
    const aliasedInstance = new Implementation();
    const connectedCallbackStub = stub(instance, 'connectedCallback');
    const disconnectedCallbackStub = stub(instance, 'disconnectedCallback');
    const renderStub = stub(instance, 'render');
    t.is(connectedCallbackStub.callCount, 0);
    t.is(disconnectedCallbackStub.callCount, 0);
    t.is(renderStub.callCount, 0);
    aliasedInstance.connectedCallback();
    aliasedInstance.disconnectedCallback();
    aliasedInstance.render();
    t.is(connectedCallbackStub.callCount, 1);
    t.is(disconnectedCallbackStub.callCount, 1);
    t.is(renderStub.callCount, 1);
});

test.serial(
    'It should be able to use the mergeProps in the render method;',
    async t => {
        const { instance } = t.context;
        const quote = starwars();
        const mergeProps = { quote };
        const getInitialPropsStub = stub(u, 'getInitialProps');
        await instance.render(mergeProps);
        t.true(
            getInitialPropsStub.calledWith(instance, mergeProps, match.promise)
        );
        getInitialPropsStub.restore();
    }
);

test.serial(
    'It should not continue if the current task has become invalid',
    async t => {
        const { instance, injectors } = t.context;
        const getInitialPropsStub = stub(u, 'getInitialProps');
        const task = instance.render();
        injectors.queue.drop(task);
        await task;
        t.is(getInitialPropsStub.callCount, 0);
    }
);
